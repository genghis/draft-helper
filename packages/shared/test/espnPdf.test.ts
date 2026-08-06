import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksLikeEspnPdf, parseEspnPdfLines } from "../src/parse/espnPdf.js";
import { matchEntries } from "../src/normalize.js";
import type { Player } from "../src/types.js";

const lines: string[] = JSON.parse(
  readFileSync(new URL("./fixtures/espn-rankings-lines.json", import.meta.url), "utf8")
);

describe("parseEspnPdfLines (real ESPN export)", () => {
  const entries = parseEspnPdfLines(lines);

  it("recovers the complete 300-player list", () => {
    expect(entries).toHaveLength(300);
    expect(entries[0]).toMatchObject({ name: "Jahmyr Gibbs", rank: 1, position: "RB", team: "DET" });
    expect(entries[299]).toMatchObject({ rank: 300, position: "DST" });
  });

  it("returns entries in rank order despite the four-column page layout", () => {
    // Reading order interleaves 1, 81, 161, 241, 2, ... so this would fail if
    // we trusted document order instead of each row's own rank.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.rank).toBe(entries[i - 1]!.rank + 1);
    }
  });

  it("dedupes the repeated header row rather than emitting rank 1 twice", () => {
    expect(entries.filter((e) => e.rank === 1)).toHaveLength(1);
  });

  it("carries position and team for every row", () => {
    expect(entries.every((e) => e.position !== undefined)).toBe(true);
    expect(entries.every((e) => /^[A-Z]{2,4}$/.test(e.team ?? ""))).toBe(true);
  });

  it("flattens tiers, since the export has none", () => {
    expect(new Set(entries.map((e) => e.tier))).toEqual(new Set([1]));
  });

  it("ignores documents that are not this format", () => {
    expect(parseEspnPdfLines(["Hello", "world"])).toEqual([]);
    expect(looksLikeEspnPdf(lines)).toBe(true);
    expect(looksLikeEspnPdf(["a bill", "some prose", "2. not a rank"])).toBe(false);
  });
});

describe("matchEntries uses declared position and team", () => {
  const players: Player[] = [
    { id: "wr", name: "Mike Williams", position: "WR", team: "NYJ", espnId: 1 },
    { id: "dl", name: "Mike Williams", position: "TE", team: "LAC", espnId: 2 },
    { id: "solo", name: "Zay Flowers", position: "WR", team: "BAL", espnId: 3 },
  ];

  it("settles a shared name by position instead of asking the user", () => {
    const { matched, unmatched } = matchEntries(
      [{ name: "Mike Williams", rank: 1, tier: 1, position: "WR" }],
      players,
      "OVERALL"
    );
    expect(unmatched).toHaveLength(0);
    expect(matched[0]!.player.id).toBe("wr");
  });

  it("settles a shared name by team when positions agree", () => {
    const twoWrs: Player[] = [
      { id: "a", name: "Mike Williams", position: "WR", team: "NYJ", espnId: 1 },
      { id: "b", name: "Mike Williams", position: "WR", team: "LAC", espnId: 2 },
    ];
    const { matched } = matchEntries(
      [{ name: "Mike Williams", rank: 1, tier: 1, position: "WR", team: "LAC" }],
      twoWrs,
      "OVERALL"
    );
    expect(matched[0]!.player.id).toBe("b");
  });

  it("still asks when nothing distinguishes them", () => {
    const { unmatched } = matchEntries(
      [{ name: "Mike Williams", rank: 1, tier: 1 }],
      players,
      "OVERALL"
    );
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.candidates).toHaveLength(2);
  });

  it("does not discard a match when the declared team is stale", () => {
    // A source listing last season's team must not drop an unambiguous player.
    const { matched } = matchEntries(
      [{ name: "Zay Flowers", rank: 1, tier: 1, position: "WR", team: "KC" }],
      players,
      "OVERALL"
    );
    expect(matched[0]!.player.id).toBe("solo");
  });

  it("canonicalizes team aliases (WSH/WAS, JAC/JAX)", () => {
    const two: Player[] = [
      { id: "x", name: "Same Name", position: "WR", team: "WAS", espnId: 1 },
      { id: "y", name: "Same Name", position: "WR", team: "JAX", espnId: 2 },
    ];
    const { matched } = matchEntries(
      [{ name: "Same Name", rank: 1, tier: 1, team: "WSH" }],
      two,
      "OVERALL"
    );
    expect(matched[0]!.player.id).toBe("x");
  });
});
