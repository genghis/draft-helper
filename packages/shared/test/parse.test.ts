import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  leadingIndexOffset,
  parsePositionCell,
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
    expect(leadingIndexOffset(["a", "b"], [["1", "x", "y"], ["2", "p", "q"]])).toBe(1);
    expect(leadingIndexOffset(["a", "b"], [["x", "y"], ["p", "q"]])).toBe(0);
    // A short/ragged data row must never produce a negative shift.
    expect(leadingIndexOffset(["a", "b", "c"], [["x"]])).toBe(0);
  });

  it("does not mistake a trailing delimiter for a row index", () => {
    // "1,Chase,1," splits to 4 fields against a 3-field header, and its first
    // column is a rank, so consecutive-integer checks alone are fooled. The
    // empty final field is what gives it away.
    expect(
      leadingIndexOffset(["rank", "player", "tier"], [["1", "Chase", "1", ""], ["2", "Lamb", "1", ""]])
    ).toBe(0);
  });

  it("requires the extra column to actually count rows", () => {
    expect(leadingIndexOffset(["a", "b"], [["x", "p", "q"], ["y", "r", "s"]])).toBe(0);
    // Non-consecutive first column is not a row index.
    expect(leadingIndexOffset(["a", "b"], [["1", "p", "q"], ["7", "r", "s"]])).toBe(0);
  });
});

describe("CSV shapes that must not silently degrade", () => {
  // Each of these once produced plausible-looking garbage rather than an error.
  const rows = (csv: string) => parseRankings(csv).map((e) => e.name);

  it("handles a trailing delimiter on every data row", () => {
    expect(rows("Rank,Player,Tier\n1,Ja'Marr Chase,1,\n2,Bijan Robinson,1,")).toEqual([
      "Ja'Marr Chase",
      "Bijan Robinson",
    ]);
  });

  it("handles CRLF, a BOM, and quoted separators", () => {
    expect(rows("Rank,Player,Tier\r\n1,Chase,1\r\n2,Lamb,1")).toEqual(["Chase", "Lamb"]);
    expect(rows("\uFEFFRank,Player,Tier\n1,Chase,1")).toEqual(["Chase"]);
    // A comma inside a quoted field of a TAB file stays part of the name.
    expect(rows('Player.Name\tTier\n"Smith, John"\t1')).toEqual(["Smith, John"]);
    // A tab inside a quoted field of a COMMA file does not flip the delimiter.
    expect(rows('Rank,Player,Tier\n1,"A\tB",1')).toEqual(["A\tB"]);
  });
});

describe("real-world ranking exports", () => {
  it("parses a tab-separated fftiers export with an unnamed rank column", () => {
    const entries = parseRankings(fixture("fftiers-tab.csv"));
    expect(entries).toHaveLength(200);
    // The row-index column must not be mistaken for the player name.
    // Also carries a Position column, which the parser now reads.
    expect(entries[0]).toMatchObject({ name: "Ja'Marr Chase", rank: 1, tier: 1, position: "WR" });
    expect(entries.every((e) => /[A-Za-z]/.test(e.name))).toBe(true);
    expect(entries.every((e) => Number.isFinite(e.rank) && e.rank > 0)).toBe(true);
    // Tiers are real and increase down the list.
    expect(new Set(entries.map((e) => e.tier)).size).toBeGreaterThan(3);
    expect(entries[entries.length - 1]!.tier).toBeGreaterThan(entries[0]!.tier);
  });

  it("parses a quoted comma FantasyPros export", () => {
    const entries = parseRankings(fixture("fantasypros.csv"));
    expect(entries).toHaveLength(847);
    expect(entries[0]).toMatchObject({
      name: "Jahmyr Gibbs",
      rank: 1,
      tier: 1,
      position: "RB",
      team: "DET",
    });
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

describe("malformed exports fail honestly rather than inventing players", () => {
  const chen = fixture("fftiers-tab.csv").split(/\r?\n/);

  it("refuses an fftiers file with a stray extra column", () => {
    // Previously produced 200 players named "1", "2", "3" — the project's
    // signature failure. Zero entries surfaces a real error to the user.
    const broken = [chen[0], chen[1] + "\t", ...chen.slice(2)].join("\n");
    expect(parseRankings(broken)).toEqual([]);
  });

  it("never emits a row number as a player name", () => {
    const broken = [chen[0], chen[1] + "\t", ...chen.slice(2)].join("\n");
    expect(parseRankings(broken).some((e) => /^\d+$/.test(e.name))).toBe(false);
  });

  it("does not donate a single-column file's own header as a player", () => {
    expect(parseRankings("Player\nJa'Marr Chase\nBijan Robinson").map((e) => e.name)).toEqual([
      "Ja'Marr Chase",
      "Bijan Robinson",
    ]);
  });

  it("survives an unnamed but non-empty trailing column", () => {
    // Same field-count signature as a leading row index; only checking that the
    // shifted column yields a real name tells them apart.
    const csv = "Rank,Player,Tier\n1,Ja'Marr Chase,1,notes\n2,Bijan Robinson,1,more";
    expect(parseRankings(csv).map((e) => e.name)).toEqual(["Ja'Marr Chase", "Bijan Robinson"]);
  });
});

describe("parsePositionCell", () => {
  it("reads the shapes sources actually publish", () => {
    expect(parsePositionCell("RB")).toBe("RB");
    // FantasyPros attaches the positional rank.
    expect(parsePositionCell("RB1")).toBe("RB");
    expect(parsePositionCell("wr12")).toBe("WR");
    expect(parsePositionCell("D/ST")).toBe("DST");
    expect(parsePositionCell("DEF")).toBe("DST");
    expect(parsePositionCell("PK")).toBe("K");
  });

  it("returns undefined rather than guessing", () => {
    // A wrong position now vetoes matches, so an unknown cell must stay silent.
    expect(parsePositionCell("IDP")).toBeUndefined();
    expect(parsePositionCell("")).toBeUndefined();
    expect(parsePositionCell(undefined)).toBeUndefined();
    expect(parsePositionCell("99")).toBeUndefined();
  });
});

describe("position and team are read from columns sources already publish", () => {
  it("captures them from a FantasyPros export", () => {
    const entries = parseRankings(fixture("fantasypros.csv"));
    expect(entries[0]).toMatchObject({ name: "Jahmyr Gibbs", position: "RB", team: "DET" });
    // Every row, not just the first.
    expect(entries.every((e) => e.position !== undefined)).toBe(true);
  });

  it("captures position from the fftiers overall list", () => {
    const entries = parseRankings(fixture("fftiers-overall.csv"));
    expect(entries).toHaveLength(200);
    expect(entries[0]).toMatchObject({ name: "Ja'Marr Chase", rank: 1, tier: 1, position: "WR" });
    // This list carries real tiers, unlike the ESPN PDF.
    expect(Math.max(...entries.map((e) => e.tier))).toBeGreaterThan(10);
    expect(entries.every((e) => e.position !== undefined)).toBe(true);
  });

  it("leaves them undefined when the source omits them", () => {
    const entries = parseRankings("Rank,Player,Tier\n1,Ja'Marr Chase,1");
    expect(entries[0]!.position).toBeUndefined();
    expect(entries[0]!.team).toBeUndefined();
  });
});
