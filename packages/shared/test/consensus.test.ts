import { describe, expect, it } from "vitest";
import {
  agreementFromRows,
  consensusRanking,
  consensusToRanked,
  highDisagreementIds,
} from "../src/consensus.js";
import type { RankedPlayer } from "../src/tiers.js";

const src = (...rows: [string, number, number][]): RankedPlayer[] =>
  rows.map(([playerId, rank, tier]) => ({ playerId, rank, tier }));

describe("consensusRanking", () => {
  it("orders by average rank across sources with full coverage", () => {
    const a = src(["p1", 1, 1], ["p2", 2, 1], ["p3", 3, 2]);
    const b = src(["p1", 2, 1], ["p2", 1, 1], ["p3", 3, 2]);
    const out = consensusRanking([a, b]);
    // p1 avg 1.5, p2 avg 1.5 (tie → coverage equal → playerId), p3 avg 3.
    expect(out.map((r) => r.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(out.every((r) => r.coverage === 2)).toBe(true);
  });

  it("handles partial coverage — a player in one source floats on its rank", () => {
    const a = src(["p1", 1, 1], ["p2", 5, 2]);
    const b = src(["p1", 3, 1]); // p2 absent here
    const out = consensusRanking([a, b]);
    const p1 = out.find((r) => r.playerId === "p1")!;
    const p2 = out.find((r) => r.playerId === "p2")!;
    expect(p1.coverage).toBe(2); // avg (1+3)/2 = 2
    expect(p2.coverage).toBe(1); // avg 5
    expect(out.map((r) => r.playerId)).toEqual(["p1", "p2"]);
  });

  it("breaks avg-rank ties toward broader coverage", () => {
    // both average 2, but p1 seen in 2 sources, p2 in 1.
    const a = src(["p1", 2, 1]);
    const b = src(["p1", 2, 1], ["p2", 2, 1]);
    const out = consensusRanking([a, b]);
    expect(out[0]!.playerId).toBe("p1");
  });

  it("rounds average tier and clamps to >= 1", () => {
    expect(consensusRanking([src(["p", 1, 1]), src(["p", 1, 2])])[0]!.tier).toBe(2); // 1.5→2
    expect(consensusRanking([src(["p", 1, 1]), src(["p", 1, 1]), src(["p", 1, 2])])[0]!.tier).toBe(1); // 1.33→1
  });

  it("reports zero spread at single coverage and nonzero otherwise", () => {
    expect(consensusRanking([src(["p", 3, 1])])[0]!.spread).toBe(0);
    expect(consensusRanking([src(["p", 1, 1]), src(["p", 3, 1])])[0]!.spread).toBe(1); // stddev of {1,3}
  });

  it("returns empty for no sources", () => {
    expect(consensusRanking([])).toEqual([]);
    expect(consensusRanking([[], []])).toEqual([]);
  });
});

describe("consensusToRanked", () => {
  it("projects rows to the RankedPlayer shape", () => {
    const rows = consensusRanking([src(["p1", 1, 1], ["p2", 2, 2])]);
    expect(consensusToRanked(rows)).toEqual([
      { playerId: "p1", rank: 1, tier: 1 },
      { playerId: "p2", rank: 2, tier: 2 },
    ]);
  });
});

describe("agreement helpers", () => {
  it("builds the agreement map from rows", () => {
    const rows = consensusRanking([src(["p1", 1, 1]), src(["p1", 5, 1])]);
    expect(agreementFromRows(rows)).toEqual({ p1: { coverage: 2, spread: 2 } });
  });

  it("flags the highest-spread players and stays empty without enough signal", () => {
    // Five players, increasing disagreement; the top of the spread distribution
    // is flagged, the tightly-agreed ones are not.
    const a = src(["p1", 1, 1], ["p2", 2, 1], ["p3", 3, 1], ["p4", 4, 1], ["p5", 5, 1]);
    const b = src(["p1", 2, 1], ["p2", 4, 1], ["p3", 6, 2], ["p4", 10, 2], ["p5", 25, 4]);
    const flagged = highDisagreementIds(agreementFromRows(consensusRanking([a, b])));
    expect(flagged.has("p5")).toBe(true);
    expect(flagged.has("p1")).toBe(false);
    // Too few players / unanimous → nothing flagged.
    expect(highDisagreementIds({ x: { coverage: 2, spread: 0 } }).size).toBe(0);
  });
});

describe("consensus monotonic tiers", () => {
  it("keeps tier non-decreasing down the rank order (no band interleave)", () => {
    // p1 ranks best on average but its sources tier it worse (2,3 -> 2.5 -> 3);
    // p2 ranks just behind but tiers cleaner (1,2 -> 1.5 -> 2). Naive rounding
    // would give p1 tier 3, p2 tier 2 -> interleaved. Running-max prevents it.
    const a = src(["p1", 1, 2], ["p2", 2, 1]);
    const b = src(["p1", 1, 3], ["p2", 2, 2]);
    const rows = consensusRanking([a, b]);
    const tiers = rows.map((r) => r.tier);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]!).toBeGreaterThanOrEqual(tiers[i - 1]!);
  });
});
