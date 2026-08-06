import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  leadingIndexOffset,
  parseBorisChenCsv,
  parseBorisChenText,
} from "../src/parse/borischen.js";
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

describe("detectDelimiter", () => {
  it("picks whichever delimiter actually splits the header", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    // A tab export whose names contain commas must still read as tab-separated.
    expect(detectDelimiter("Player.Name\tTier\tNotes, extra")).toBe("\t");
    expect(detectDelimiter("single")).toBe(",");
  });
});

describe("leadingIndexOffset", () => {
  it("detects R's unnamed row-name column", () => {
    expect(leadingIndexOffset(["a", "b"], ["1", "x", "y"])).toBe(1);
    expect(leadingIndexOffset(["a", "b"], ["x", "y"])).toBe(0);
    // A short/ragged data row must never produce a negative shift.
    expect(leadingIndexOffset(["a", "b", "c"], ["x"])).toBe(0);
  });
});

describe("real-world ranking exports", () => {
  it("parses a tab-separated fftiers export with an unnamed rank column", () => {
    const entries = parseRankings(fixture("fftiers-tab.csv"));
    expect(entries).toHaveLength(200);
    // The row-index column must not be mistaken for the player name.
    expect(entries[0]).toEqual({ name: "Ja'Marr Chase", rank: 1, tier: 1 });
    expect(entries.every((e) => /[A-Za-z]/.test(e.name))).toBe(true);
    expect(entries.every((e) => Number.isFinite(e.rank) && e.rank > 0)).toBe(true);
    // Tiers are real and increase down the list.
    expect(new Set(entries.map((e) => e.tier)).size).toBeGreaterThan(3);
    expect(entries[entries.length - 1]!.tier).toBeGreaterThan(entries[0]!.tier);
  });

  it("parses a quoted comma FantasyPros export", () => {
    const entries = parseRankings(fixture("fantasypros.csv"));
    expect(entries).toHaveLength(847);
    expect(entries[0]).toEqual({ name: "Jahmyr Gibbs", rank: 1, tier: 1 });
    // Ranks come from the RK column, not row order, and stay unique.
    expect(new Set(entries.map((e) => e.rank)).size).toBe(entries.length);
    expect(entries.some((e) => e.name === "San Francisco 49ers")).toBe(true);
  });

  it("keeps hyphenated and apostrophe names intact", () => {
    const entries = parseRankings(fixture("fantasypros.csv"));
    expect(entries.some((e) => e.name === "Jaxon Smith-Njigba")).toBe(true);
    expect(entries.some((e) => e.name.includes("'"))).toBe(true);
  });
});
