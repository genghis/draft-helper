import type { AdpForPlayer } from "./types.js";

/** ESPN is the primary market signal; fall back to FFC when ESPN has no ADP. */
export function primaryAdp(v: AdpForPlayer | undefined): number | undefined {
  return v?.espn ?? v?.ffc;
}

/**
 * Ranks a board's players by market ADP (1 = drafted earliest). Ranking within
 * the board's own set works uniformly for position boards (RBs vs RBs) and
 * OVERALL boards, sidestepping the overall-vs-positional mismatch. Players
 * without an ADP are simply absent from the result.
 */
export function boardAdpRanks(primaryAdpById: Map<string, number>): Map<string, number> {
  const sorted = [...primaryAdpById.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );
  const ranks = new Map<string, number>();
  sorted.forEach(([id], i) => ranks.set(id, i + 1));
  return ranks;
}

/** How far the two markets disagree on a player, or null if only one has ADP. */
export function adpDivergence(v: AdpForPlayer): number | null {
  return v.espn != null && v.ffc != null ? Math.abs(v.espn - v.ffc) : null;
}

/**
 * Value vs the market: the player's ADP rank minus your board rank. Positive =
 * the market drafts him later than you rank him (a value / faller); negative =
 * you rank him ahead of the market (a reach).
 */
export function adpValue(boardRank: number, adpRank: number): number {
  return adpRank - boardRank;
}
