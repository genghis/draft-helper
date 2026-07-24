import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  BoardPosition,
  Placement,
  ScoringFormat,
  SessionUser,
  TierBand,
} from "@drafthelper/shared";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  putLayout,
} from "./db/boards.js";
import { deletePick, listPicks, putPick, resetDraft } from "./db/draft.js";
import {
  createUser,
  getUser,
  getUserIdByInviteHash,
  listUsers,
  rotateInvite,
} from "./db/users.js";
import { fetchBorisChen } from "./import/borischen.js";

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
app.get("/draft", async (c) => c.json(await listPicks(c.get("user").id)));

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
