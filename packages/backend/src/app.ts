import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  BoardPosition,
  Placement,
  ScoringFormat,
  SessionUser,
  TierBand,
} from "@drafthelper/shared";
import { mapEspnPicks } from "@drafthelper/shared";
import type { ExtPicksRequest } from "@drafthelper/shared";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  putLayout,
  updateBoardMeta,
} from "./db/boards.js";
import {
  deletePick,
  getDraftSync,
  listPicks,
  putEspnPick,
  putPick,
  resetDraft,
  touchDraftMeta,
} from "./db/draft.js";
import {
  createExtToken,
  getUserIdByExtTokenHash,
  revokeExtToken,
} from "./db/extTokens.js";
import {
  createUser,
  getUser,
  getUserIdByInviteHash,
  listUsers,
  rotateInvite,
  setEspnSettings,
} from "./db/users.js";
import { fetchCompletedDraft, fetchLeagueName } from "./espn/client.js";
import { fetchBorisChen } from "./import/borischen.js";
import { getPlayerMaps } from "./players/load.js";

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "FLX"]);
const SCORINGS = new Set(["STD", "HALF", "PPR"]);
import {
  SESSION_COOKIE,
  hashInviteToken,
  issueSessionCookie,
  verifySession,
} from "./lib/session.js";

type Env = { Variables: { user: SessionUser } };

export const app = new Hono<Env>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/auth/login", async (c) => {
  const invite = c.req.query("invite");
  if (!invite) return c.json({ error: "missing invite token" }, 400);
  const userId = await getUserIdByInviteHash(hashInviteToken(invite));
  if (!userId) return c.json({ error: "invalid invite" }, 403);
  const user = await getUser(userId);
  if (!user) return c.json({ error: "invalid invite" }, 403);
  c.header("Set-Cookie", await issueSessionCookie(userId));
  return c.redirect("/");
});

// ── Extension API (bearer token, not session — the extension's service
// worker can't send our SameSite=Lax cookie). Registered before the session
// gate so these routes short-circuit past it, like /auth/login does. ──────
app.use("/ext/*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = token
    ? await getUserIdByExtTokenHash(hashInviteToken(token))
    : null;
  const user = userId ? await getUser(userId) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", { id: user.id, name: user.name, admin: user.admin });
  await next();
});

app.get("/ext/ping", (c) =>
  c.json({ userId: c.get("user").id, name: c.get("user").name })
);

const MAX_EXT_PICKS = 400;

app.post("/ext/picks", async (c) => {
  const body = await c.req.json<Partial<ExtPicksRequest>>().catch(() => null);
  if (
    typeof body?.myTeamId !== "number" ||
    !Array.isArray(body.picks) ||
    body.picks.length > MAX_EXT_PICKS ||
    body.picks.some(
      (p) =>
        typeof p?.espnPlayerId !== "number" ||
        typeof p?.overall !== "number" ||
        typeof p?.teamId !== "number"
    )
  ) {
    return c.json({ error: "invalid picks payload" }, 400);
  }
  const maps = await getPlayerMaps();
  const { picks, unmapped } = mapEspnPicks(
    maps.espnIdToPlayerId,
    maps.dstPlayerIdByTeam,
    body as ExtPicksRequest
  );
  let written = 0;
  let skipped = 0;
  for (const pick of picks) {
    (await putEspnPick(c.get("user").id, pick)) ? written++ : skipped++;
  }
  await touchDraftMeta(c.get("user").id);
  return c.json({ written, skipped, unmapped });
});

/** Everything below requires a session. */
app.use("*", async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  const userId = cookie ? await verifySession(cookie) : null;
  const user = userId ? await getUser(userId) : null;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", { id: user.id, name: user.name, admin: user.admin });
  await next();
});

app.get("/me", (c) => c.json(c.get("user")));

// ── Personal settings (extension token, ESPN cookies) ─────────────────
app.get("/me/settings", async (c) => {
  const profile = await getUser(c.get("user").id);
  return c.json({
    espn: profile?.espn ? { leagueId: profile.espn.leagueId } : null,
  });
});

app.post("/me/ext-token", async (c) => {
  const token = await createExtToken(c.get("user").id);
  if (!token) return c.json({ error: "no such user" }, 404);
  return c.json({ token });
});

app.delete("/me/ext-token", async (c) => {
  await revokeExtToken(c.get("user").id);
  return c.json({ ok: true });
});

app.put("/me/espn", async (c) => {
  const body = await c.req
    .json<{ leagueId?: unknown; espnS2?: unknown; swid?: unknown }>()
    .catch(() => null);
  const leagueId = typeof body?.leagueId === "string" ? body.leagueId.trim() : "";
  const espnS2 = typeof body?.espnS2 === "string" ? body.espnS2.trim() : "";
  const swid = typeof body?.swid === "string" ? body.swid.trim() : "";
  if (!leagueId || !/^\d+$/.test(leagueId) || !espnS2 || !swid) {
    return c.json({ error: "leagueId, espnS2 and swid required" }, 400);
  }
  await setEspnSettings(c.get("user").id, { leagueId, espnS2, swid });
  return c.json({ ok: true });
});

app.delete("/me/espn", async (c) => {
  await setEspnSettings(c.get("user").id, null);
  return c.json({ ok: true });
});

const CURRENT_SEASON = Number(process.env.ESPN_SEASON ?? new Date().getFullYear());

app.post("/me/espn/test", async (c) => {
  const profile = await getUser(c.get("user").id);
  if (!profile?.espn) return c.json({ error: "no ESPN settings saved" }, 400);
  const name = await fetchLeagueName(profile.espn.leagueId, CURRENT_SEASON, {
    espnS2: profile.espn.espnS2,
    swid: profile.espn.swid,
  });
  if (name === null) {
    return c.json({ error: "ESPN rejected the request — re-grab your cookies" }, 502);
  }
  return c.json({ leagueName: name });
});

// ── Imports ───────────────────────────────────────────────────────────
app.get("/imports/borischen", async (c) => {
  const position = c.req.query("position") ?? "";
  const scoring = c.req.query("scoring") ?? "STD";
  if (!POSITIONS.has(position) || !SCORINGS.has(scoring)) {
    return c.json({ error: "invalid position or scoring" }, 400);
  }
  const result = await fetchBorisChen(
    position as BoardPosition,
    scoring as ScoringFormat
  );
  if (!result) {
    return c.json(
      { error: "Boris Chen file not found — paste the tiers instead" },
      502
    );
  }
  return c.json(result);
});

// ── Boards ────────────────────────────────────────────────────────────
app.get("/boards", async (c) => c.json(await listBoards(c.get("user").id)));

app.post("/boards", async (c) => {
  const body = await c.req
    .json<{
      name?: unknown;
      position?: unknown;
      scoring?: unknown;
      bands?: unknown;
      placements?: unknown;
    }>()
    .catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const position = body?.position as string;
  const scoring = body?.scoring as string;
  const bands = body?.bands;
  const placements = body?.placements;
  if (
    !name ||
    name.length > 80 ||
    !POSITIONS.has(position) ||
    !SCORINGS.has(scoring) ||
    !Array.isArray(bands) ||
    typeof placements !== "object" ||
    placements === null ||
    Object.keys(placements).length > 1000
  ) {
    return c.json({ error: "invalid board" }, 400);
  }
  const meta = await createBoard(c.get("user").id, {
    name,
    position: position as BoardPosition,
    scoring: scoring as ScoringFormat,
    bands: bands as TierBand[],
    placements: placements as Record<string, Placement>,
  });
  return c.json(meta, 201);
});

app.get("/boards/:id", async (c) => {
  const board = await getBoard(c.req.param("id"));
  if (!board || board.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(board);
});

app.put("/boards/:id", async (c) => {
  const board = await getBoard(c.req.param("id"));
  if (!board || board.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  const body = await c.req
    .json<{ name?: unknown; bands?: unknown }>()
    .catch(() => null);
  const changes: { name?: string; bands?: TierBand[] } = {};
  if (body?.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) {
      return c.json({ error: "invalid name" }, 400);
    }
    changes.name = body.name.trim();
  }
  if (body?.bands !== undefined) {
    if (
      !Array.isArray(body.bands) ||
      body.bands.some(
        (b) =>
          typeof b?.y0 !== "number" ||
          typeof b?.y1 !== "number" ||
          b.y0 >= b.y1 ||
          typeof b?.label !== "string"
      )
    ) {
      return c.json({ error: "invalid bands" }, 400);
    }
    changes.bands = body.bands as TierBand[];
  }
  if (changes.name === undefined && changes.bands === undefined) {
    return c.json({ error: "nothing to update" }, 400);
  }
  const meta = await updateBoardMeta(c.req.param("id"), changes);
  if (!meta) return c.json({ error: "not found" }, 404);
  return c.json(meta);
});

app.put("/boards/:id/layout", async (c) => {
  const board = await getBoard(c.req.param("id"));
  if (!board || board.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  const body = await c.req
    .json<{ placements?: unknown; version?: unknown }>()
    .catch(() => null);
  if (
    typeof body?.placements !== "object" ||
    body.placements === null ||
    typeof body.version !== "number"
  ) {
    return c.json({ error: "placements and version required" }, 400);
  }
  const version = await putLayout(
    c.req.param("id"),
    body.placements as Record<string, Placement>,
    body.version
  );
  if (version === null) return c.json({ error: "version conflict" }, 409);
  return c.json({ version });
});

app.delete("/boards/:id", async (c) => {
  const board = await getBoard(c.req.param("id"));
  if (!board || board.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  await deleteBoard(c.req.param("id"));
  return c.json({ ok: true });
});

// ── Draft picks (one implicit draft per user) ─────────────────────────
app.get("/draft", async (c) => {
  const userId = c.get("user").id;
  const [picks, sync] = await Promise.all([listPicks(userId), getDraftSync(userId)]);
  return c.json({ picks, sync });
});

/** Reconciles from ESPN once the real draft has completed. */
app.post("/draft/import-espn", async (c) => {
  const profile = await getUser(c.get("user").id);
  if (!profile?.espn) return c.json({ error: "no ESPN settings saved" }, 400);
  const result = await fetchCompletedDraft(profile.espn.leagueId, CURRENT_SEASON, {
    espnS2: profile.espn.espnS2,
    swid: profile.espn.swid,
  });
  if (!result) {
    return c.json({ error: "ESPN rejected the request — re-grab your cookies" }, 502);
  }
  if (!result.drafted) {
    return c.json({ error: "draft not complete yet on ESPN" }, 409);
  }
  const maps = await getPlayerMaps();
  const myTeamId = Number(c.req.query("myTeamId") ?? 0);
  const { picks, unmapped } = mapEspnPicks(maps.espnIdToPlayerId, maps.dstPlayerIdByTeam, {
    myTeamId,
    picks: result.picks,
  });
  let written = 0;
  let skipped = 0;
  for (const pick of picks) {
    (await putEspnPick(c.get("user").id, pick)) ? written++ : skipped++;
  }
  return c.json({ written, skipped, unmapped });
});

app.put("/draft/picks/:playerId", async (c) => {
  const body = await c.req.json<{ mine?: unknown }>().catch(() => ({}) as { mine?: unknown });
  const pick = await putPick(c.get("user").id, c.req.param("playerId"), {
    mine: body?.mine === true,
    source: "manual",
  });
  return c.json(pick);
});

app.delete("/draft/picks/:playerId", async (c) => {
  await deletePick(c.get("user").id, c.req.param("playerId"));
  return c.json({ ok: true });
});

app.delete("/draft", async (c) =>
  c.json({ deleted: await resetDraft(c.get("user").id) })
);

app.use("/admin/*", async (c, next) => {
  if (!c.get("user").admin) return c.json({ error: "forbidden" }, 403);
  await next();
});

app.get("/admin/users", async (c) => c.json(await listUsers()));

app.post("/admin/users", async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 50) {
    return c.json({ error: "name must be 1-50 characters" }, 400);
  }
  const { id, token } = await createUser(name);
  return c.json({ id, name, token }, 201);
});

app.post("/admin/users/:id/invite", async (c) => {
  const token = await rotateInvite(c.req.param("id"));
  if (!token) return c.json({ error: "no such user" }, 404);
  return c.json({ token });
});
