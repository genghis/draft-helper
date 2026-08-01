import { describe, expect, it } from "vitest";
import {
  appendBand,
  APPENDED_BAND_HEIGHT,
  bestAvailable,
  currentTierScarcity,
  layoutFromRanked,
  moveBandBoundary,
  projectBands,
  RANK_SPACING,
  isTileableBands,
  MAX_BANDS,
  removeBand,
  renameBand,
  SPREAD_LANE_GAP,
  splitBand,
  spreadOffset,
  spreadPlacements,
} from "../src/tiers.js";

/** Bands must tile the space with no gaps or overlaps for projectBands to work. */
function expectContiguous(bands: { y0: number; y1: number }[]) {
  for (let i = 1; i < bands.length; i++) {
    expect(bands[i]!.y0).toBe(bands[i - 1]!.y1);
    expect(bands[i]!.y1).toBeGreaterThan(bands[i]!.y0);
  }
}

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

describe("splitBand", () => {
  it("splits a tier in two without moving anyone", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    const before = projectBands(placements, bands);
    const split = splitBand(bands, 0, bands[0]!.y0 + RANK_SPACING);
    expect(split).toHaveLength(bands.length + 1);
    expectContiguous(split);
    // Same players on the board, just distributed across one more tier.
    const after = projectBands(placements, split);
    expect(after.flatMap((g) => g.playerIds).sort()).toEqual(
      before.flatMap((g) => g.playerIds).sort()
    );
  });

  it("renumbers the tiers below the split", () => {
    const { bands } = layoutFromRanked(ranked);
    expect(bands.map((b) => b.label)).toEqual(["Tier 1", "Tier 2", "Tier 3"]);
    const split = splitBand(bands, 0, bands[0]!.y0 + RANK_SPACING);
    expect(split.map((b) => b.label)).toEqual(["Tier 1", "Tier 2", "Tier 3", "Tier 4"]);
  });

  it("keeps renamed labels through a split", () => {
    const bands = [
      { y0: 0, y1: 100, label: "Studs" },
      { y0: 100, y1: 200, label: "Tier 2" },
    ];
    const split = splitBand(bands, 1, 150);
    expect(split.map((b) => b.label)).toEqual(["Studs", "Tier 2", "Tier 3"]);
  });

  it("clamps the cut and refuses when there isn't room", () => {
    const roomy = [{ y0: 0, y1: 100, label: "Tier 1" }];
    expect(splitBand(roomy, 0, -999)[0]!.y1).toBe(RANK_SPACING);
    expect(splitBand(roomy, 0, 99999)[0]!.y1).toBe(100 - RANK_SPACING);
    const tight = [{ y0: 0, y1: RANK_SPACING, label: "Tier 1" }];
    expect(splitBand(tight, 0, 5)).toBe(tight);
    expect(splitBand(roomy, 9, 50)).toBe(roomy);
  });
});

describe("appendBand", () => {
  it("adds an empty tier below the last one", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    const next = appendBand(bands);
    expectContiguous(next);
    const added = next[next.length - 1]!;
    expect(added.y0).toBe(bands[bands.length - 1]!.y1);
    expect(added.y1 - added.y0).toBe(APPENDED_BAND_HEIGHT);
    expect(added.label).toBe("Tier 4");
    // Empty until you drag someone down into it.
    const groups = projectBands(placements, next);
    expect(groups[groups.length - 1]!.playerIds).toEqual([]);
  });

  it("works from no bands at all", () => {
    const next = appendBand([]);
    expect(next).toHaveLength(1);
    expect(next[0]!.y0).toBe(0);
  });
});

describe("removeBand", () => {
  it("gives the removed tier's space to the one above", () => {
    const { bands } = layoutFromRanked(ranked);
    const next = removeBand(bands, 1);
    expect(next).toHaveLength(bands.length - 1);
    expectContiguous(next);
    expect(next[0]!.y1).toBe(bands[1]!.y1);
  });

  it("gives the first tier's space to the one below", () => {
    const { bands } = layoutFromRanked(ranked);
    const next = removeBand(bands, 0);
    expect(next[0]!.y0).toBe(bands[0]!.y0);
    expectContiguous(next);
  });

  it("never orphans a player outside every band", () => {
    const { placements, bands } = layoutFromRanked(ranked);
    for (let i = 0; i < bands.length; i++) {
      const groups = projectBands(placements, removeBand(bands, i));
      expect(groups.flatMap((g) => g.playerIds)).toHaveLength(ranked.length);
    }
  });

  it("refuses to remove the last band or an unknown index", () => {
    const one = [{ y0: 0, y1: 10, label: "Tier 1" }];
    expect(removeBand(one, 0)).toBe(one);
    const { bands } = layoutFromRanked(ranked);
    expect(removeBand(bands, 9)).toBe(bands);
  });
});

describe("renameBand", () => {
  it("renames one band and leaves geometry alone", () => {
    const { bands } = layoutFromRanked(ranked);
    const next = renameBand(bands, 1, "Value picks");
    expect(next[1]!.label).toBe("Value picks");
    expect(next[1]!.y0).toBe(bands[1]!.y0);
    expect(next[0]).toEqual(bands[0]);
  });

  it("survives a later split without being renumbered", () => {
    const { bands } = layoutFromRanked(ranked);
    const renamed = renameBand(bands, 0, "Studs");
    const split = splitBand(renamed, 2, renamed[2]!.y0 + RANK_SPACING);
    expect(split[0]!.label).toBe("Studs");
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

describe("isTileableBands", () => {
  it("accepts what the band operations produce", () => {
    const { bands } = layoutFromRanked(ranked);
    expect(isTileableBands(bands)).toBe(true);
    expect(isTileableBands(splitBand(bands, 0, bands[0]!.y0 + RANK_SPACING))).toBe(true);
    expect(isTileableBands(appendBand(bands))).toBe(true);
    expect(isTileableBands(removeBand(bands, 1))).toBe(true);
  });

  it("rejects a gap between bands — the silent-misassignment case", () => {
    expect(
      isTileableBands([
        { y0: 0, y1: 10, label: "Tier 1" },
        { y0: 20, y1: 30, label: "Tier 2" },
      ])
    ).toBe(false);
  });

  it("rejects overlapping and out-of-order bands", () => {
    expect(
      isTileableBands([
        { y0: 0, y1: 20, label: "Tier 1" },
        { y0: 10, y1: 30, label: "Tier 2" },
      ])
    ).toBe(false);
    expect(
      isTileableBands([
        { y0: 20, y1: 30, label: "Tier 2" },
        { y0: 0, y1: 10, label: "Tier 1" },
      ])
    ).toBe(false);
  });

  it("rejects inverted, non-finite, empty and oversized band sets", () => {
    expect(isTileableBands([{ y0: 10, y1: 10, label: "x" }])).toBe(false);
    expect(isTileableBands([{ y0: 10, y1: 5, label: "x" }])).toBe(false);
    expect(isTileableBands([{ y0: 0, y1: Infinity, label: "x" }])).toBe(false);
    expect(isTileableBands([{ y0: NaN, y1: 10, label: "x" }])).toBe(false);
    // Allowed: projectBands treats "no bands" as a real state, so a board
    // stored that way must stay saveable.
    expect(isTileableBands([])).toBe(true);
    expect(isTileableBands("nope")).toBe(false);
    const many = Array.from({ length: MAX_BANDS + 1 }, (_, i) => ({
      y0: i * 10,
      y1: i * 10 + 10,
      label: `Tier ${i + 1}`,
    }));
    expect(isTileableBands(many)).toBe(false);
    expect(isTileableBands(many.slice(0, MAX_BANDS))).toBe(true);
  });

  it("rejects a missing or overlong label", () => {
    expect(isTileableBands([{ y0: 0, y1: 10 }])).toBe(false);
    expect(isTileableBands([{ y0: 0, y1: 10, label: "x".repeat(41) }])).toBe(false);
  });

  it("tolerates float drift within epsilon", () => {
    expect(
      isTileableBands([
        { y0: 0, y1: 0.1 + 0.2, label: "Tier 1" },
        { y0: 0.3, y1: 1, label: "Tier 2" },
      ])
    ).toBe(true);
  });
});
