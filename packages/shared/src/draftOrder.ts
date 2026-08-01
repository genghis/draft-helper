import type { Pick } from "./types.js";

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 20;

/**
 * ESPN team ids are 1-based. The extension reports 0 when it saw a pick but
 * could not tell who made it (a DOM rescan rather than a WebSocket frame), so
 * 0 means "unknown" and must never bind a seat.
 */
function isRealTeamId(id: number | undefined): id is number {
  return id !== undefined && id > 0;
}

/** One seat in the draft. Index in DraftOrder.teams is the slot (0-based). */
export interface DraftTeam {
  name: string;
  /** ESPN fantasy team id, learned from live picks; absent until round 1 reveals it. */
  espnTeamId?: number;
}

export interface DraftOrder {
  teamCount: number;
  /** Length always equals teamCount; unnamed seats carry an empty name. */
  teams: DraftTeam[];
  /** The user's own slot (0-based), or null while unknown. */
  mySlot: number | null;
}

export function emptyOrder(teamCount = 12): DraftOrder {
  return {
    teamCount,
    teams: Array.from({ length: teamCount }, () => ({ name: "" })),
    mySlot: null,
  };
}

/** Grows or trims the seat list to match a new team count, keeping existing names. */
export function resizeOrder(order: DraftOrder, teamCount: number): DraftOrder {
  // NaN would clamp to MIN_TEAMS and silently drop seats; leave the order alone.
  if (!Number.isFinite(teamCount)) return order;
  const clamped = Math.min(Math.max(Math.trunc(teamCount), MIN_TEAMS), MAX_TEAMS);
  const teams = Array.from({ length: clamped }, (_, i) => order.teams[i] ?? { name: "" });
  return {
    teamCount: clamped,
    teams,
    mySlot: order.mySlot !== null && order.mySlot < clamped ? order.mySlot : null,
  };
}

/**
 * Which slot picks at a given overall number, snaking: odd rounds run
 * 0..n-1, even rounds run back n-1..0.
 */
export function slotForOverall(overall: number, teamCount: number): number {
  const index = overall - 1;
  const round = Math.floor(index / teamCount);
  const seat = index % teamCount;
  return round % 2 === 0 ? seat : teamCount - 1 - seat;
}

/** Overall pick number as round + pick-in-round, both 1-based (for "1.3"). */
export function roundAndPick(
  overall: number,
  teamCount: number
): { round: number; pick: number } {
  const index = overall - 1;
  return { round: Math.floor(index / teamCount) + 1, pick: (index % teamCount) + 1 };
}

/** Overall number of a slot's pick in a given 1-based round. */
export function overallForSlot(slot: number, round: number, teamCount: number): number {
  const seat = round % 2 === 1 ? slot : teamCount - 1 - slot;
  return (round - 1) * teamCount + seat + 1;
}

/**
 * The next overall pick belonging to a slot, given how many picks are already
 * in. Returns the current pick when it's that slot's turn.
 */
export function nextOverallForSlot(
  slot: number,
  teamCount: number,
  picksMade: number
): number {
  const nextOverall = picksMade + 1;
  const round = Math.floor((nextOverall - 1) / teamCount) + 1;
  const thisRound = overallForSlot(slot, round, teamCount);
  return thisRound >= nextOverall ? thisRound : overallForSlot(slot, round + 1, teamCount);
}

/**
 * Orders picks into the draft sequence. A pick's `overall` from the extension
 * is authoritative; manually marked picks have none, so they fall back to
 * marking order (`pickedAt`) after the numbered ones.
 */
export function sequencePicks(picks: Pick[]): Pick[] {
  const numbered = picks
    .filter((p) => p.overall !== undefined)
    .sort((a, b) => a.overall! - b.overall!);
  const rest = picks
    .filter((p) => p.overall === undefined)
    .sort((a, b) => a.pickedAt.localeCompare(b.pickedAt));
  return [...numbered, ...rest];
}

export interface BoardRow {
  overall: number;
  round: number;
  pick: number;
  slot: number;
  team: DraftTeam | undefined;
  playerId: string;
  mine: boolean;
  /** True when the drafter came from live ESPN data rather than snake position. */
  attributed: boolean;
}

/**
 * ESPN team id -> seat. A duplicated id (two seats bound to the same team,
 * usually a wrong team count) is dropped rather than resolved to whichever
 * seat happened to be last — a wrong confident answer is worse than falling
 * back to the snake position, which at least renders with a "?".
 */
function seatIndex(order: DraftOrder): Map<number, number> {
  const seen = new Map<number, number>();
  const duplicated = new Set<number>();
  order.teams.forEach((t, i) => {
    if (!isRealTeamId(t.espnTeamId)) return;
    if (seen.has(t.espnTeamId)) duplicated.add(t.espnTeamId);
    else seen.set(t.espnTeamId, i);
  });
  for (const id of duplicated) seen.delete(id);
  return seen;
}

/**
 * The running board: every pick in sequence with the team that made it.
 * Prefers the real ESPN team id when the extension supplied one, and falls
 * back to the snake position otherwise.
 */
export function buildBoard(picks: Pick[], order: DraftOrder): BoardRow[] {
  const slotByEspnId = seatIndex(order);
  const sequenced = sequencePicks(picks);
  // Un-numbered (manually marked) picks are numbered above the highest real
  // overall, never from their index: with a gap in the ESPN run, an index-based
  // number would collide with a real pick and mislabel both rows.
  let highest = 0;
  for (const p of sequenced) {
    if (p.overall !== undefined && p.overall > highest) highest = p.overall;
  }
  let fabricated = 0;
  return sequenced.map((pick) => {
    const overall = pick.overall ?? highest + ++fabricated;
    const known = isRealTeamId(pick.espnTeamId)
      ? slotByEspnId.get(pick.espnTeamId)
      : undefined;
    const slot = known ?? slotForOverall(overall, order.teamCount);
    const { round, pick: inRound } = roundAndPick(overall, order.teamCount);
    return {
      overall,
      round,
      pick: inRound,
      slot,
      team: order.teams[slot],
      playerId: pick.playerId,
      mine: pick.mine,
      attributed: known !== undefined,
    };
  });
}

/**
 * Fills seats from round 1's live picks: pick k belongs to slot k-1, so the
 * first round reveals the whole order without anyone typing it. Only fills
 * blanks — a name or id you set by hand always wins. Returns the same object
 * when nothing was learned, so callers can skip a redundant save.
 */
export function deriveOrder(picks: Pick[], order: DraftOrder): DraftOrder {
  const teams = order.teams.map((t) => ({ ...t }));
  let mySlot = order.mySlot;
  let changed = false;

  for (const pick of sequencePicks(picks)) {
    if (pick.overall === undefined || !isRealTeamId(pick.espnTeamId)) continue;
    if (pick.overall > order.teamCount) break; // round 1 is all we need
    const slot = pick.overall - 1;
    const seat = teams[slot];
    if (!seat) continue;
    if (seat.espnTeamId === undefined) {
      seat.espnTeamId = pick.espnTeamId;
      if (!seat.name) seat.name = `Team ${pick.espnTeamId}`;
      changed = true;
    }
    if (pick.mine && mySlot === null) {
      mySlot = slot;
      changed = true;
    }
  }
  return changed ? { ...order, teams, mySlot } : order;
}

export interface TurnStatus {
  /** Overall number of the user's next pick. */
  nextOverall: number;
  round: number;
  pick: number;
  /** 0 when they're on the clock. */
  picksAway: number;
}

/**
 * How deep the draft actually is. The stored pick count undercounts whenever a
 * pick is dropped (an ESPN player our crossref can't map), which would slide
 * every countdown; the highest known overall is authoritative when present.
 */
export function picksMade(picks: Pick[]): number {
  let highest = 0;
  for (const p of picks) {
    if (p.overall !== undefined && p.overall > highest) highest = p.overall;
  }
  return Math.max(picks.length, highest);
}

/** Where the user stands right now, or null when their slot isn't known yet. */
export function turnStatus(
  picksMade: number,
  order: DraftOrder
): TurnStatus | null {
  if (order.mySlot === null) return null;
  const nextOverall = nextOverallForSlot(order.mySlot, order.teamCount, picksMade);
  const { round, pick } = roundAndPick(nextOverall, order.teamCount);
  return { nextOverall, round, pick, picksAway: nextOverall - picksMade - 1 };
}

export const MAX_TEAM_NAME = 40;

/**
 * Whether an untrusted value is a usable DraftOrder: seat list sized to
 * teamCount, mySlot either null or a real seat, and no unknown keys on a seat
 * (storage builds items from named fields, and this keeps the two in step).
 */
export function isValidDraftOrder(v: unknown): v is DraftOrder {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const count = o.teamCount;
  if (typeof count !== "number" || !Number.isInteger(count)) return false;
  if (count < MIN_TEAMS || count > MAX_TEAMS) return false;
  if (!Array.isArray(o.teams) || o.teams.length !== count) return false;
  const teamsOk = o.teams.every(
    (t) =>
      typeof t?.name === "string" &&
      t.name.length <= MAX_TEAM_NAME &&
      (t.espnTeamId === undefined || typeof t.espnTeamId === "number") &&
      Object.keys(t).every((k) => k === "name" || k === "espnTeamId")
  );
  if (!teamsOk) return false;
  return (
    o.mySlot === null ||
    (typeof o.mySlot === "number" &&
      Number.isInteger(o.mySlot) &&
      o.mySlot >= 0 &&
      o.mySlot < count)
  );
}

/** Proportion of post-round-1 picks that must contradict the snake before we warn. */
const MISMATCH_RATIO = 0.5;

export interface OrderWarning {
  kind: "too-many-teams" | "duplicate-seat" | "order-mismatch";
  message: string;
}

/**
 * Sanity-checks the order against what the live picks actually show. A wrong
 * league size is otherwise undetectable: every round label and every countdown
 * is silently off, and nothing in the UI contradicts it.
 *
 * The mismatch check is deliberately proportional. A traded pick legitimately
 * lands a team out of snake position, so one disagreement proves nothing —
 * but a wrong team count puts most picks in the wrong seat at once.
 */
export function orderWarnings(picks: Pick[], order: DraftOrder): OrderWarning[] {
  const warnings: OrderWarning[] = [];

  const teamIds = new Set<number>();
  for (const p of picks) {
    if (isRealTeamId(p.espnTeamId)) teamIds.add(p.espnTeamId);
  }
  if (teamIds.size > order.teamCount) {
    warnings.push({
      kind: "too-many-teams",
      message: `${teamIds.size} different teams have drafted, but the league is set to ${order.teamCount}. Fix the team count — rounds and turn order are wrong until you do.`,
    });
  }

  const bound = order.teams.map((t) => t.espnTeamId).filter(isRealTeamId);
  if (new Set(bound).size !== bound.length) {
    warnings.push({
      kind: "duplicate-seat",
      message: "Two seats are linked to the same ESPN team. Unlink one so it can re-learn from live picks.",
    });
  }

  const seats = seatIndex(order);
  let checked = 0;
  let mismatched = 0;
  for (const p of picks) {
    if (p.overall === undefined || !isRealTeamId(p.espnTeamId)) continue;
    if (p.overall <= order.teamCount) continue; // round 1 defines the order
    const seat = seats.get(p.espnTeamId);
    if (seat === undefined) continue;
    checked++;
    if (seat !== slotForOverall(p.overall, order.teamCount)) mismatched++;
  }
  if (checked > 0 && mismatched / checked > MISMATCH_RATIO) {
    warnings.push({
      kind: "order-mismatch",
      message: `${mismatched} of ${checked} picks since round 1 don't match the snake order. The team count or seat order is probably wrong.`,
    });
  }

  return warnings;
}

/** Clears a seat's ESPN link so deriveOrder can re-learn it from live picks. */
export function unlinkSeat(order: DraftOrder, slot: number): DraftOrder {
  if (!order.teams[slot] || order.teams[slot]!.espnTeamId === undefined) return order;
  return {
    ...order,
    teams: order.teams.map((t, i) => (i === slot ? { name: t.name } : t)),
  };
}

/** Names that would be lost by shrinking to teamCount — the UI warns before dropping them. */
export function namedSeatsBeyond(order: DraftOrder, teamCount: number): string[] {
  return order.teams
    .slice(teamCount)
    .map((t) => t.name.trim())
    .filter(Boolean);
}
