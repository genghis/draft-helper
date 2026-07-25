import { describe, expect, it } from "vitest";
import {
  bestAvailable,
  currentTierScarcity,
  layoutFromRanked,
  moveBandBoundary,
  projectBands,
  RANK_SPACING,
  SPREAD_LANE_GAP,
  spreadOffset,
  spreadPlacements,
} from "../src/tiers.js";

const ranked = [
  { playerId: "a", rank: 1, tier: 1 },
  { playerId: "b", rank: 2, tier: 1 },
  { playerId: "c", rank: 3, tier: 2 },
  { playerId: "d", rank: 4, tier: 2 },
  { playerId: "e", rank: 5, tier: 3 },
];

describe("layoutFromRanked", () => {
  it("places by rank and builds contiguous bands", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    expect(placements["a"]!.y).toBe(1 * RANK_SPACING);
    expect(placements["e"]!.y).toBe(5 * RANK_SPACING);
    expect(bands).toHaveLength(3);
    expect(bands.map((b) => b.label)).toEqual(["Tier 1", "Tier 2", "Tier 3"]);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.y0).toBe(bands[i - 1]!.y1);
    }
  });
});

describe("projectBands", () => {
  it("round-trips the imported layout", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    const groups = projectBands(placements, bands);
    expect(groups.map((g) => g.playerIds)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("keeps players visible after drags outside all bands", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    placements["e"]!.y = 10_000;
    placements["a"]!.y = -50;
    const groups = projectBands(placements, bands);
    const all = groups.flatMap((g) => g.playerIds);
    expect(all).toHaveLength(5);
    expect(groups[0]!.playerIds[0]).toBe("a");
    expect(groups[2]!.playerIds).toContain("e");
  });

  it("falls back to a single band when none exist", () => {
    const groups = projectBands({ a: { x: 0, y: 5 }, b: { x: 0, y: 1 } }, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.playerIds).toEqual(["b", "a"]);
  });
});

describe("bestAvailable", () => {
  it("returns top remaining by y, excluding picked", () => {
    const { placements } = layoutFromRanked(ranked);
    expect(bestAvailable(placements, new Set(["a"]), 2)).toEqual(["b", "c"]);
    expect(bestAvailable(placements, new Set(), 3)).toEqual(["a", "b", "c"]);
    expect(bestAvailable(placements, new Set(["a", "b", "c", "d", "e"]))).toEqual([]);
  });
});

describe("currentTierScarcity", () => {
  it("reports the first band with players left", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    expect(currentTierScarcity(placements, bands, new Set(["a"]))).toEqual({
      band: bands[0],
      remaining: 1,
    });
    expect(currentTierScarcity(placements, bands, new Set(["a", "b"]))).toEqual({
      band: bands[1],
      remaining: 2,
    });
    expect(
      currentTierScarcity(placements, bands, new Set(["a", "b", "c", "d", "e"]))
    ).toBeNull();
  });
});

describe("moveBandBoundary", () => {
  it("moves the shared boundary keeping bands contiguous", () => {
    const { bands } = layoutFromRanked(ranked);
    const moved = moveBandBoundary(bands, 0, bands[0]!.y1 + 7);
    expect(moved[0]!.y1).toBe(bands[0]!.y1 + 7);
    expect(moved[1]!.y0).toBe(moved[0]!.y1);
    expect(moved[2]).toEqual(bands[2]);
  });

  it("clamps so neither band collapses", () => {
    const { bands } = layoutFromRanked(ranked);
    const tooHigh = moveBandBoundary(bands, 0, -999);
    expect(tooHigh[0]!.y1).toBe(bands[0]!.y0 + RANK_SPACING);
    const tooLow = moveBandBoundary(bands, 0, 99999);
    expect(tooLow[0]!.y1).toBe(bands[1]!.y1 - RANK_SPACING);
  });

  it("ignores out-of-range indexes", () => {
    const { bands } = layoutFromRanked(ranked);
    expect(moveBandBoundary(bands, 5, 10)).toBe(bands);
  });
});

describe("spreadOffset", () => {
  it("is a triangle wave that always moves one lane between neighbors", () => {
    const seq = Array.from({ length: 8 }, (_, i) => spreadOffset(i) / SPREAD_LANE_GAP);
    // lanes 0,1,2,3,2,1,0,1 recentered around (LANES-1)/2 = 1.5
    expect(seq).toEqual([-1.5, -0.5, 0.5, 1.5, 0.5, -0.5, -1.5, -0.5]);
    for (let i = 1; i < seq.length; i++) {
      expect(Math.abs(seq[i]! - seq[i - 1]!)).toBe(1);
    }
  });
});

describe("layoutFromRanked spread", () => {
  it("gives consecutive players different x while keeping y = value", () => {
    const { placements } = layoutFromRanked(ranked);
    const xs = ranked.map((r) => placements[r.playerId]!.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
    expect(placements["a"]!.x).not.toBe(placements["b"]!.x);
    expect(placements["a"]!.y).toBe(1 * RANK_SPACING);
  });
});

describe("spreadPlacements", () => {
  it("re-lanes x by value order and preserves y", () => {
    const flat = { a: { x: 500, y: 10 }, b: { x: 500, y: 20 }, c: { x: 500, y: 30 } };
    const out = spreadPlacements(flat);
    expect(out.a!.x).not.toBe(out.b!.x);
    expect(out.a!.y).toBe(10);
    expect(out.c!.y).toBe(30);
  });
});

describe("moveBandBoundary no-room guard", () => {
  it("leaves bands unchanged when there isn't room for both at minHeight", () => {
    const bands = [
      { y0: 0, y1: 10, label: "A" },
      { y0: 10, y1: 15, label: "B" },
    ];
    // combined span 15 < 2*minHeight(10) -> unchanged, never inverts.
    expect(moveBandBoundary(bands, 0, 3)).toBe(bands);
  });
});
