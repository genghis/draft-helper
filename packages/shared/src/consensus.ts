import type { BoardAgreement } from "./types.js";
import type { RankedPlayer } from "./tiers.js";

export interface ConsensusRow {
  playerId: string;
  /** Consensus rank, 1-based, assigned by average-rank order. */
  rank: number;
  /** Consensus tier = rounded mean of the tiers this player was given. */
  tier: number;
  /** How many of the input sources ranked this player. */
  coverage: number;
  /** Population stddev of the player's ranks across sources (0 at coverage 1). */
  spread: number;
}

/**
 * Blends several ranking sources into one consensus ordering. A player's
 * consensus rank comes from the mean of its ranks across the sources that
 * include it (partial coverage is fine — a player in one source floats on
 * that lone rank). Ties break toward broader coverage, then playerId for
 * determinism. `coverage` and `spread` are surfaced for a future
 * "agreement" signal; the seeded board only needs rank + tier.
 */
export function consensusRanking(sources: RankedPlayer[][]): ConsensusRow[] {
  const byPlayer = new Map<string, { ranks: number[]; tiers: number[] }>();
  for (const source of sources) {
    for (const e of source) {
      const agg = byPlayer.get(e.playerId) ?? { ranks: [], tiers: [] };
      agg.ranks.push(e.rank);
      agg.tiers.push(e.tier);
      byPlayer.set(e.playerId, agg);
    }
  }

  const rows = [...byPlayer.entries()].map(([playerId, { ranks, tiers }]) => {
    const avgRank = mean(ranks);
    return {
      playerId,
      avgRank,
      tier: Math.max(1, Math.round(mean(tiers))),
      coverage: ranks.length,
      spread: stddev(ranks, avgRank),
    };
  });

  rows.sort(
    (a, b) =>
      a.avgRank - b.avgRank ||
      b.coverage - a.coverage ||
      a.playerId.localeCompare(b.playerId)
  );

  return rows.map((r, i) => ({
    playerId: r.playerId,
    rank: i + 1,
    tier: r.tier,
    coverage: r.coverage,
    spread: r.spread,
  }));
}

/** Maps consensus rows to the RankedPlayer shape layoutFromRanked consumes. */
export function consensusToRanked(rows: ConsensusRow[]): RankedPlayer[] {
  return rows.map((r) => ({ playerId: r.playerId, rank: r.rank, tier: r.tier }));
}

/** Builds the persisted agreement map (playerId -> coverage/spread) from rows. */
export function agreementFromRows(rows: ConsensusRow[]): BoardAgreement {
  return Object.fromEntries(
    rows.map((r) => [r.playerId, { coverage: r.coverage, spread: r.spread }])
  );
}

/**
 * Ids the experts most disagree on: those whose rank spread is at or above the
 * given quantile of the board's nonzero spreads. Returns empty when there's
 * too little signal (few players, or everyone unanimous).
 */
export function highDisagreementIds(
  agreement: BoardAgreement,
  quantile = 0.75
): Set<string> {
  const spreads = Object.values(agreement)
    .map((a) => a.spread)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (spreads.length < 4) return new Set();
  const threshold = spreads[Math.floor(quantile * (spreads.length - 1))]!;
  return new Set(
    Object.entries(agreement)
      .filter(([, a]) => a.spread > 0 && a.spread >= threshold)
      .map(([id]) => id)
  );
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[], avg: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)));
}
