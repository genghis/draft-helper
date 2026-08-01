import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBorisChenCsv, parseBorisChenText } from "../src/parse/borischen.js";
import { parseRankings } from "../src/parse/generic.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseBorisChenText (real fixture)", () => {
  it("parses tiers and preserves order", () => {
    const entries = parseBorisChenText(fixture("text_QB.txt"));
    expect(entries.length).toBeGreaterThan(15);
    expect(entries[0]).toMatchObject({ name: "Joe Burrow", rank: 1, tier: 1 });
    const tiers = new Set(entries.map((e) => e.tier));
    expect(tiers.size).toBeGreaterThan(3);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.rank).toBe(entries[i - 1]!.rank + 1);
      expect(entries[i]!.tier).toBeGreaterThanOrEqual(entries[i - 1]!.tier);
    }
  });

  it("handles apostrophes in names (RB PPR fixture)", () => {
    const entries = parseBorisChenText(fixture("text_RB-PPR.txt"));
    expect(entries.some((e) => e.name === "De'Von Achane")).toBe(true);
  });
});

describe("parseBorisChenCsv (real fixture)", () => {
  it("maps Rank, Player.Name, Tier columns", () => {
    const entries = parseBorisChenCsv(fixture("weekly-RB-PPR.csv"));
    expect(entries.length).toBeGreaterThan(30);
    expect(entries[0]!.rank).toBe(1);
    expect(entries[0]!.name.length).toBeGreaterThan(2);
    expect(entries.every((e) => e.tier >= 1)).toBe(true);
  });
});

describe("parseRankings", () => {
  it("routes tier text", () => {
    const entries = parseRankings("Tier 1: A One, B Two\nTier 2: C Three");
    expect(entries).toHaveLength(3);
    expect(entries[2]).toMatchObject({ name: "C Three", tier: 2, rank: 3 });
  });

  it("routes Boris Chen CSV by Player.Name header", () => {
    const entries = parseRankings(fixture("weekly-QB.csv"));
    expect(entries.length).toBeGreaterThan(15);
  });

  it("parses generic headered CSV", () => {
    const entries = parseRankings("Rank,Player,Tier\n1,A One,1\n2,B Two,2");
    expect(entries).toEqual([
      { name: "A One", rank: 1, tier: 1 },
      { name: "B Two", rank: 2, tier: 2 },
    ]);
  });

  it("parses plain numbered lines", () => {
    const entries = parseRankings("1. A One\n2. B Two\n3) C Three");
    expect(entries.map((e) => e.name)).toEqual(["A One", "B Two", "C Three"]);
  });

  it("drops position-rank labels so they can't fuzzy-match a real player", () => {
    const entries = parseRankings("TE19\nA One\nRB 12\nD/ST\nB Two\nWR\n2025\n---");
    expect(entries).toEqual([
      { name: "A One", rank: 1, tier: 1 },
      { name: "B Two", rank: 2, tier: 1 },
    ]);
  });

  it("drops position-rank labels in headered CSV too", () => {
    const entries = parseRankings("Rank,Player,Tier\n1,A One,1\n2,TE19,1");
    expect(entries.map((e) => e.name)).toEqual(["A One"]);
  });

  it("keeps real names that start with a position abbreviation", () => {
    const entries = parseRankings("Kenneth Walker\nTerry McLaurin\nKyren Williams");
    expect(entries).toHaveLength(3);
  });
});
