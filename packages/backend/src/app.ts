import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  BoardAgreement,
  BoardPosition,
  DraftOrder,
  Placement,
  RankedPlayer,
  ScoringFormat,
  SeedTool,
  SessionUser,
  TagColor,
  TierBand,
} from "@drafthelper/shared";
import {
  isTileableBands,
  MAX_SOURCE_ENTRIES,
  isValidDraftOrder,
  mapEspnPicks,
  TAG_COLORS,
} from "@drafthelper/shared";
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
  getDraftOrder,
  getDraftSync,
  listPicks,
  putDraftOrder,
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
  createSource,
  deleteSource,
  getSource,
  listSources,
} from "./db/sources.js";
import { createTag, deleteTag, getTag, listTags, updateTag } from "./db/tags.js";
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

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "FLX", "OVERALL"]);
const SCORINGS = new Set(["STD", "HALF", "PPR"]);
const SEED_TOOLS = new Set(["single", "consensus"]);
const MAX_TAG_PLAYERS = 300;
const MAX_ID_LENGTH = 64;
const TAG_COLOR_SET = new Set<string>(TAG_COLORS);

const MAX_PLACEMENTS = 1000;
/** A placements map: object, capped, every value a numeric {x,y}. */
function isValidPlacements(v: unknown): v is Record<string, Placement> {
  if (typeof v !== "object" || v === null) return false;
  const vals = Object.values(v as Record<string, unknown>);
  if (vals.length > MAX_PLACEMENTS) return false;
  return vals.every(
    (p) =>
      typeof (p as { x?: unknown }).x === "number" &&
      typeof (p as { y?: unknown }).y === "number"
  );
}

/** Loose shape check for the optional per-player agreement map on a board. */
function isValidAgreement(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const entries = Object.values(v as Record<string, unknown>);
  if (entries.length > MAX_SOURCE_ENTRIES) return false;
  return entries.every(
    (a) =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as { coverage?: unknown }).coverage === "number" &&
      typeof (a as { spread?: unknown }).spread === "number"
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/**
 * The invite-link confirmation page. On Continue it POSTs the invite (read from
 * this page's own URL) to /auth/login with the OAC body-hash header, then lands
 * in the app — so login needs a deliberate same-site click, not a bare GET.
 */
function loginPage(name: string | null, error: string | null): string {
  const body = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : `<p>Log in to Draft Helper as <strong>${escapeHtml(name ?? "")}</strong>?</p>
       <button id="go">Continue</button><p id="msg" class="err"></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft Helper — Sign in</title>
<style>:root{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif}
body{max-width:22rem;margin:4rem auto;padding:0 1rem;text-align:center}
button{font:inherit;padding:.6rem 1.4rem;margin-top:.5rem;cursor:pointer}
.err{color:#c0392b}</style></head><body><h1>Draft Helper</h1>${body}
<script>
var b=document.getElementById('go');
if(b)b.addEventListener('click',async function(){
  b.disabled=true;
  var invite=new URLSearchParams(location.search).get('invite')||'';
  var payload=JSON.stringify({invite:invite});
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  var hash=Array.from(new Uint8Array(buf)).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
  var r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-amz-content-sha256':hash},body:payload});
  if(r.ok){location.href='/'}else{document.getElementById('msg').textContent='Login failed — ask for a fresh invite link.';b.disabled=false}
});
</script></body></html>`;
}
import {
  SESSION_COOKIE,
  hashInviteToken,
  issueSessionCookie,
  verifySession,
} from "./lib/session.js";

type Env = { Variables: { user: SessionUser } };

export const app = new Hono<Env>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

// The invite link opens a confirmation page rather than logging in on GET.
// This closes login-CSRF (a cross-site GET can no longer silently sign a
// victim into someone else's account) while keeping links clickable and
// reusable; the actual cookie is set by the POST below, which requires the
// user's click and the OAC-signed body header a forged form can't supply.
app.get("/auth/login", async (c) => {
  const invite = c.req.query("invite");
  if (!invite) return c.html(loginPage(null, "Missing invite token."), 400);
  const userId = await getUserIdByInviteHash(hashInviteToken(invite));
  const user = userId ? await getUser(userId) : null;
  if (!user) return c.html(loginPage(null, "This invite link is invalid or expired."), 403);
  c.header("Referrer-Policy", "no-referrer");
  return c.html(loginPage(user.name, null));
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ invite?: unknown }>().catch(() => null);
  const invite = typeof body?.invite === "string" ? body.invite : "";
  if (!invite) return c.json({ error: "missing invite token" }, 400);
  const userId = await getUserIdByInviteHash(hashInviteToken(invite));
  const user = userId ? await getUser(userId) : null;
  if (!userId || !user) return c.json({ error: "invalid invite" }, 403);
  c.header("Set-Cookie", await issueSessionCookie(userId));
  return c.json({ ok: true });
});

// ── Extension API (bearer token, not session — the extension's service
// worker can't send our SameSite=Lax cookie). Registered before the session
// gate so these routes short-circuit past it, like /auth/login does. ──────
app.use("/ext/*", async (c, next) => {
  // Token rides in x-dh-token: CloudFront's OAC signs origin requests and
  // overwrites Authorization with its own SigV4 signature, so a Bearer
  // header never survives the hop. Authorization kept for local/direct use.
  const header = c.req.header("authorization") ?? "";
  const token =
    c.req.header("x-dh-token") ??
    (header.startsWith("Bearer ") ? header.slice(7) : null);
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
      sourceIds?: unknown;
      seededBy?: unknown;
      agreement?: unknown;
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
    !isTileableBands(bands) ||
    !isValidPlacements(placements)
  ) {
    return c.json({ error: "invalid board" }, 400);
  }
  const sourceIds =
    Array.isArray(body?.sourceIds) &&
    body.sourceIds.length <= MAX_SOURCE_ENTRIES &&
    body.sourceIds.every((s) => typeof s === "string")
      ? (body.sourceIds as string[])
      : undefined;
  const seededBy =
    typeof body?.seededBy === "string" && SEED_TOOLS.has(body.seededBy)
      ? (body.seededBy as SeedTool)
      : undefined;
  const agreement = isValidAgreement(body?.agreement)
    ? (body?.agreement as BoardAgreement)
    : undefined;
  const meta = await createBoard(c.get("user").id, {
    name,
    position: position as BoardPosition,
    scoring: scoring as ScoringFormat,
    bands: bands as TierBand[],
    placements: placements as Record<string, Placement>,
    sourceIds,
    seededBy,
    agreement,
  });
  return c.json(meta, 201);
});

// ── Sources (immutable imported ranking lists) ────────────────────────
app.get("/sources", async (c) => c.json(await listSources(c.get("user").id)));

app.post("/sources", async (c) => {
  const body = await c.req
    .json<{ name?: unknown; scope?: unknown; scoring?: unknown; entries?: unknown }>()
    .catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const scope = body?.scope as string;
  const scoring = body?.scoring as string;
  const entries = body?.entries;
  const validEntries =
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.length <= MAX_SOURCE_ENTRIES &&
    entries.every(
      (e) =>
        typeof e?.playerId === "string" &&
        typeof e?.rank === "number" &&
        typeof e?.tier === "number"
    );
  if (!name || name.length > 80 || !POSITIONS.has(scope) || !SCORINGS.has(scoring) || !validEntries) {
    return c.json({ error: "invalid source" }, 400);
  }
  const meta = await createSource(c.get("user").id, {
    name,
    scope: scope as BoardPosition,
    scoring: scoring as ScoringFormat,
    entries: entries as RankedPlayer[],
  });
  return c.json(meta, 201);
});

app.get("/sources/:id", async (c) => {
  const source = await getSource(c.req.param("id"));
  if (!source || source.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(source);
});

app.delete("/sources/:id", async (c) => {
  const source = await getSource(c.req.param("id"));
  if (!source || source.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  await deleteSource(c.req.param("id"));
  return c.json({ ok: true });
});

// ── Tags (editable player membership sets — sleepers, my guys, etc.) ──
app.get("/tags", async (c) => c.json(await listTags(c.get("user").id)));

function validateLabel(v: unknown): string | null {
  const label = typeof v === "string" ? v.trim() : "";
  return label && label.length <= 80 ? label : null;
}

function validateColor(v: unknown): TagColor | null {
  return typeof v === "string" && TAG_COLOR_SET.has(v) ? (v as TagColor) : null;
}

function validPlayerIds(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= MAX_TAG_PLAYERS &&
    v.every((id) => typeof id === "string" && id.length <= MAX_ID_LENGTH)
  );
}

/** Like validPlayerIds but allows empty — needed for the auto-managed handcuff
 * tag, which can legitimately have zero members after retractions/exclusions. */
function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_TAG_PLAYERS &&
    v.every((id) => typeof id === "string" && id.length <= MAX_ID_LENGTH)
  );
}

/** At most one tag per owner may be the auto-managed handcuff tag. */
async function handcuffTagConflict(ownerId: string, excludeTagId?: string): Promise<boolean> {
  const tags = await listTags(ownerId);
  return tags.some((t) => t.autoManaged === "handcuff" && t.id !== excludeTagId);
}

app.post("/tags", async (c) => {
  const body = await c.req
    .json<{
      label?: unknown;
      color?: unknown;
      playerIds?: unknown;
      autoManaged?: unknown;
      autoAddedIds?: unknown;
      autoExcludedIds?: unknown;
    }>()
    .catch(() => null);
  const label = validateLabel(body?.label);
  const color = validateColor(body?.color);
  const playerIds = body?.playerIds;
  if (!label || !color || !validPlayerIds(playerIds)) {
    return c.json({ error: "invalid tag" }, 400);
  }
  if (body?.autoManaged !== undefined && body.autoManaged !== "handcuff") {
    return c.json({ error: "invalid autoManaged" }, 400);
  }
  if (body?.autoAddedIds !== undefined && !isStringArray(body.autoAddedIds)) {
    return c.json({ error: "invalid autoAddedIds" }, 400);
  }
  if (body?.autoExcludedIds !== undefined && !isStringArray(body.autoExcludedIds)) {
    return c.json({ error: "invalid autoExcludedIds" }, 400);
  }
  if (body?.autoManaged === "handcuff" && (await handcuffTagConflict(c.get("user").id))) {
    return c.json({ error: "a handcuff tag already exists" }, 400);
  }
  const meta = await createTag(c.get("user").id, {
    label,
    color,
    playerIds,
    ...(body?.autoManaged !== undefined ? { autoManaged: body.autoManaged as "handcuff" } : {}),
    ...(body?.autoAddedIds !== undefined ? { autoAddedIds: body.autoAddedIds as string[] } : {}),
    ...(body?.autoExcludedIds !== undefined
      ? { autoExcludedIds: body.autoExcludedIds as string[] }
      : {}),
  });
  return c.json(meta, 201);
});

app.get("/tags/:id", async (c) => {
  const tag = await getTag(c.req.param("id"));
  if (!tag || tag.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(tag);
});

app.put("/tags/:id", async (c) => {
  const tag = await getTag(c.req.param("id"));
  if (!tag || tag.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  const body = await c.req
    .json<{
      label?: unknown;
      color?: unknown;
      playerIds?: unknown;
      autoManaged?: unknown;
      autoAddedIds?: unknown;
      autoExcludedIds?: unknown;
      version?: unknown;
    }>()
    .catch(() => null);
  if (typeof body?.version !== "number") {
    return c.json({ error: "version required" }, 400);
  }
  const changes: {
    label?: string;
    color?: TagColor;
    playerIds?: string[];
    autoManaged?: "handcuff";
    autoAddedIds?: string[];
    autoExcludedIds?: string[];
  } = {};
  if (body?.label !== undefined) {
    const label = validateLabel(body.label);
    if (!label) return c.json({ error: "invalid label" }, 400);
    changes.label = label;
  }
  if (body?.color !== undefined) {
    const color = validateColor(body.color);
    if (!color) return c.json({ error: "invalid color" }, 400);
    changes.color = color;
  }
  if (body?.autoManaged !== undefined) {
    if (body.autoManaged !== "handcuff") return c.json({ error: "invalid autoManaged" }, 400);
    if (await handcuffTagConflict(c.get("user").id, tag.meta.id)) {
      return c.json({ error: "a handcuff tag already exists" }, 400);
    }
    changes.autoManaged = body.autoManaged;
  }
  if (body?.playerIds !== undefined) {
    // Unlike POST, PUT allows empty — but only for the auto-managed handcuff
    // tag, which can legitimately shrink to zero members.
    if (!isStringArray(body.playerIds)) return c.json({ error: "invalid playerIds" }, 400);
    const resultingAutoManaged = changes.autoManaged ?? tag.meta.autoManaged;
    if (body.playerIds.length === 0 && resultingAutoManaged !== "handcuff") {
      return c.json({ error: "playerIds cannot be empty" }, 400);
    }
    changes.playerIds = body.playerIds;
  }
  if (body?.autoAddedIds !== undefined) {
    if (!isStringArray(body.autoAddedIds)) return c.json({ error: "invalid autoAddedIds" }, 400);
    changes.autoAddedIds = body.autoAddedIds;
  }
  if (body?.autoExcludedIds !== undefined) {
    if (!isStringArray(body.autoExcludedIds)) {
      return c.json({ error: "invalid autoExcludedIds" }, 400);
    }
    changes.autoExcludedIds = body.autoExcludedIds;
  }
  const meta = await updateTag(c.req.param("id"), changes, body.version);
  if (!meta) return c.json({ error: "version conflict" }, 409);
  return c.json(meta);
});

app.delete("/tags/:id", async (c) => {
  const tag = await getTag(c.req.param("id"));
  if (!tag || tag.meta.ownerId !== c.get("user").id) {
    return c.json({ error: "not found" }, 404);
  }
  await deleteTag(c.req.param("id"));
  return c.json({ ok: true });
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
    .json<{ name?: unknown; bands?: unknown; version?: unknown }>()
    .catch(() => null);
  const changes: { name?: string; bands?: TierBand[] } = {};
  if (body?.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) {
      return c.json({ error: "invalid name" }, 400);
    }
    changes.name = body.name.trim();
  }
  if (body?.bands !== undefined) {
    if (!isTileableBands(body.bands)) {
      return c.json({ error: "invalid bands" }, 400);
    }
    changes.bands = body.bands;
  }
  if (changes.name === undefined && changes.bands === undefined) {
    return c.json({ error: "nothing to update" }, 400);
  }
  // Band writes replace the whole array, so a stale tab would re-tier every
  // player. Callers that send a version get optimistic concurrency; ones that
  // don't keep the previous last-write-wins behaviour.
  const expected = typeof body?.version === "number" ? body.version : undefined;
  const meta = await updateBoardMeta(c.req.param("id"), changes, expected);
  if (!meta) {
    return expected === undefined
      ? c.json({ error: "not found" }, 404)
      : c.json({ error: "version conflict" }, 409);
  }
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
  if (!isValidPlacements(body?.placements) || typeof body?.version !== "number") {
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
  const [picks, sync, order] = await Promise.all([
    listPicks(userId),
    getDraftSync(userId),
    getDraftOrder(userId),
  ]);
  return c.json({ picks, sync, order });
});

/**
 * The draft order: seat list plus which seat is the user's. Replaced whole,
 * last write wins — it is small, single-user, and edited from one screen.
 */
app.put("/draft/order", async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isValidDraftOrder(body)) return c.json({ error: "invalid order" }, 400);
  return c.json(await putDraftOrder(c.get("user").id, body));
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
