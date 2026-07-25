import type { Placement, TierBand } from "./types.js";

/** Vertical canvas units per rank position; y = value, smaller is better. */
export const RANK_SPACING = 10;
/** Default horizontal center for imported placements. */
export const DEFAULT_X = 500;
/** How many horizontal lanes the initial import zigzag uses. */
export const SPREAD_LANES = 4;
/** Canvas x units between adjacent lanes. */
export const SPREAD_LANE_GAP = 160;

/**
 * Horizontal offset for the i-th player in value order — a triangle wave
 * across the lanes (0,1,2,3,2,1,0,…). Adjacent players always land one lane
 * apart, so they read clearly instead of stacking in one column, while y
 * still carries the value ordering.
 */
export function spreadOffset(index: number): number {
  const period = (SPREAD_LANES - 1) * 2;
  const p = index % period;
  const lane = p < SPREAD_LANES ? p : period - p;
  return (lane - (SPREAD_LANES - 1) / 2) * SPREAD_LANE_GAP;
}

export interface RankedPlayer {
  playerId: string;
  rank: number;
  tier: number;
}

/**
 * Lays ranked, tiered players onto the canvas: y from rank, x spread across
 * lanes so chips don't overlap, tier bands as horizontal stripes with
 * boundaries midway between adjacent tiers' ranks.
 */
export function layoutFromRanked(ranked: RankedPlayer[]): {
  placements: Record<string, Placement>;
  bands: TierBand[];
} {
  const sorted = [...ranked].sort((a, b) => a.rank - b.rank);
  const placements: Record<string, Placement> = {};
  sorted.forEach((r, i) => {
    placements[r.playerId] = { x: DEFAULT_X + spreadOffset(i), y: r.rank * RANK_SPACING };
  });

  const bands: TierBand[] = [];
  const tiers = [...new Set(sorted.map((r) => r.tier))].sort((a, b) => a - b);
  for (const tier of tiers) {
    const inTier = sorted.filter((r) => r.tier === tier);
    const prev = bands[bands.length - 1];
    const first = inTier[0]!.rank;
    const last = inTier[inTier.length - 1]!.rank;
    const nextTier = tiers[tiers.indexOf(tier) + 1];
    const nextFirst = nextTier
      ? sorted.find((r) => r.tier === nextTier)!.rank
      : last + 1;
    bands.push({
      y0: prev ? prev.y1 : (first - 0.5) * RANK_SPACING,
      y1: ((last + nextFirst) / 2) * RANK_SPACING,
      label: `Tier ${tier}`,
    });
  }
  return { placements, bands };
}

/**
 * Re-spaces an existing layout: keeps each player's y (value) but reassigns x
 * to the lane zigzag in value order. Used to tidy a board — including ones
 * imported before the spread existed — without disturbing the tier bands.
 */
export function spreadPlacements(
  placements: Record<string, Placement>
): Record<string, Placement> {
  const ids = Object.keys(placements).sort((a, b) => placements[a]!.y - placements[b]!.y);
  const next: Record<string, Placement> = {};
  ids.forEach((id, i) => {
    next[id] = { x: DEFAULT_X + spreadOffset(i), y: placements[id]!.y };
  });
  return next;
}

export interface BandGroup {
  band: TierBand;
  playerIds: string[];
}

/** Top remaining players on a board (ids sorted by y, picked ones excluded). */
export function bestAvailable(
  placements: Record<string, Placement>,
  picked: ReadonlySet<string>,
  limit = 3
): string[] {
  return Object.keys(placements)
    .filter((id) => !picked.has(id))
    .sort((a, b) => placements[a]!.y - placements[b]!.y)
    .slice(0, limit);
}

/**
 * Moves the boundary between bands[index] and bands[index+1], clamped so
 * neither band collapses below minHeight. Bands stay contiguous (y1[i] ===
 * y0[i+1]). Returns a new array; the input is not mutated.
 */
export function moveBandBoundary(
  bands: TierBand[],
  index: number,
  newY: number,
  minHeight = RANK_SPACING
): TierBand[] {
  const upper = bands[index];
  const lower = bands[index + 1];
  if (!upper || !lower) return bands;
  const y = Math.min(Math.max(newY, upper.y0 + minHeight), lower.y1 - minHeight);
  return bands.map((band, i) =>
    i === index ? { ...band, y1: y } : i === index + 1 ? { ...band, y0: y } : band
  );
}

export interface TierScarcity {
  band: TierBand;
  remaining: number;
}

/**
 * The board's current tier (first band with anyone left) and how many remain
 * in it — the "1 RB left in Tier 3" warning input.
 */
export function currentTierScarcity(
  placements: Record<string, Placement>,
  bands: TierBand[],
  picked: ReadonlySet<string>
): TierScarcity | null {
  for (const group of projectBands(placements, bands)) {
    const remaining = group.playerIds.filter((id) => !picked.has(id)).length;
    if (remaining > 0) return { band: group.band, remaining };
  }
  return null;
}

/**
 * Projects canvas placements back into tiered lists: players grouped by the
 * band containing their y, sorted by y within each band. Players outside
 * every band are appended to the nearest band.
 */
export function projectBands(
  placements: Record<string, Placement>,
  bands: TierBand[]
): BandGroup[] {
  const groups: BandGroup[] = bands.map((band) => ({ band, playerIds: [] }));
  if (groups.length === 0) {
    return [
      {
        band: { y0: 0, y1: Number.MAX_SAFE_INTEGER, label: "All" },
        playerIds: Object.keys(placements).sort(
          (a, b) => placements[a]!.y - placements[b]!.y
        ),
      },
    ];
  }
  const ids = Object.keys(placements).sort(
    (a, b) => placements[a]!.y - placements[b]!.y
  );
  for (const id of ids) {
    const y = placements[id]!.y;
    let group = groups.find((g) => y >= g.band.y0 && y < g.band.y1);
    if (!group) {
      group = y < groups[0]!.band.y0 ? groups[0]! : groups[groups.length - 1]!;
    }
    group.playerIds.push(id);
  }
  return groups;
}
