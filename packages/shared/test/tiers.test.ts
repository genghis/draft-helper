import { describe, expect, it } from "vitest";
import { layoutFromRanked, projectBands, RANK_SPACING } from "../src/tiers.js";

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
