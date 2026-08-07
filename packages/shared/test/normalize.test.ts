import { describe, expect, it } from "vitest";
import { levenshtein, matchEntries, normalizeName, unflipName } from "../src/normalize.js";
import type { ParsedEntry, Player } from "../src/types.js";

const players: Player[] = [
  { id: "1", name: "Kenneth Walker III", position: "RB", team: "SEA", espnId: 101 },
  { id: "2", name: "De'Von Achane", position: "RB", team: "MIA", espnId: 102 },
  { id: "3", name: "Travis Etienne Jr.", position: "RB", team: "JAX", espnId: 103 },
  { id: "4", name: "Josh Allen", position: "QB", team: "BUF", espnId: 104 },
  { id: "5", name: "Jahmyr Gibbs", position: "RB", team: "DET", espnId: 105 },
  { id: "6", name: "Denver Broncos", position: "DST", team: "DEN", espnId: 106 },
  { id: "7", name: "New England Patriots", position: "DST", team: "NE", espnId: 107 },
];

function entry(name: string, rank = 1, tier = 1): ParsedEntry {
  return { name, rank, tier };
}

describe("normalizeName", () => {
  it("strips suffixes, punctuation, diacritics", () => {
    expect(normalizeName("Kenneth Walker III")).toBe("kenneth walker");
    expect(normalizeName("De'Von Achane")).toBe("devon achane");
    expect(normalizeName("Travis Etienne Jr.")).toBe("travis etienne");
    expect(normalizeName("Amon-Ra St. Brown")).toBe("amon ra st brown");
  });

  it("reorders a Lastname, Firstname entry", () => {
    expect(normalizeName("Mahomes, Patrick")).toBe("patrick mahomes");
    expect(normalizeName("St. Brown, Amon-Ra")).toBe("amon ra st brown");
    expect(normalizeName("Etienne Jr., Travis")).toBe("travis etienne");
  });
});

describe("unflipName", () => {
  it("reorders Lastname, Firstname", () => {
    expect(unflipName("Mahomes, Patrick")).toBe("Patrick Mahomes");
    expect(unflipName("St. Brown, Amon-Ra")).toBe("Amon-Ra St. Brown");
  });

  it("leaves already-ordered names alone", () => {
    expect(unflipName("Patrick Mahomes")).toBe("Patrick Mahomes");
  });

  it("does not treat a team, position, or suffix tail as a first name", () => {
    expect(unflipName("Bijan Robinson, ATL")).toBe("Bijan Robinson, ATL");
    expect(unflipName("Bijan Robinson, RB")).toBe("Bijan Robinson, RB");
    expect(unflipName("Smith, Jr.")).toBe("Smith, Jr.");
  });

  it("leaves parentheticals and multi-comma strings for the parsers", () => {
    expect(unflipName("Smith, Jr. (see notes)")).toBe("Smith, Jr. (see notes)");
    expect(unflipName("Mahomes, Patrick, KC")).toBe("Mahomes, Patrick, KC");
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("gibbs", "gibbs")).toBe(0);
    expect(levenshtein("gibbs", "gibs")).toBe(1);
    expect(levenshtein("abc", "xyz")).toBe(3);
  });
});

describe("matchEntries", () => {
  it("matches exact and suffix-free names", () => {
    const res = matchEntries(
      [entry("Kenneth Walker"), entry("Travis Etienne")],
      players,
      "RB"
    );
    expect(res.unmatched).toHaveLength(0);
    expect(res.matched.map((m) => m.player.id)).toEqual(["1", "3"]);
  });

  it("matches names entered Lastname, Firstname", () => {
    const res = matchEntries([entry("Gibbs, Jahmyr"), entry("Allen, Josh")], players, "OVERALL");
    expect(res.unmatched).toHaveLength(0);
    expect(res.matched.map((m) => m.player.id)).toEqual(["5", "4"]);
  });

  it("matches nickname variants", () => {
    const res = matchEntries([entry("Ken Walker")], players, "RB");
    expect(res.matched[0]?.player.id).toBe("1");
  });

  it("auto-accepts unambiguous single-typo names", () => {
    const res = matchEntries([entry("Jahmyr Gibs")], players, "RB");
    expect(res.matched[0]?.player.id).toBe("5");
  });

  it("respects position pools", () => {
    const res = matchEntries([entry("Josh Allen")], players, "RB");
    expect(res.matched).toHaveLength(0);
    expect(res.unmatched[0]?.candidates.length).toBeGreaterThan(0);
  });

  it("matches DST by mascot", () => {
    const res = matchEntries(
      [entry("Broncos D/ST"), entry("New England Patriots")],
      players,
      "DST"
    );
    expect(res.unmatched).toHaveLength(0);
    expect(res.matched.map((m) => m.player.id).sort()).toEqual(["6", "7"]);
  });

  it("sends unknown names to review with candidates", () => {
    const res = matchEntries([entry("Zzyzx Quorblatt")], players, "RB");
    expect(res.matched).toHaveLength(0);
    expect(res.unmatched[0]?.candidates.length).toBeGreaterThan(0);
  });

  it("matches across all positions for an OVERALL scope, DST included", () => {
    const res = matchEntries(
      [entry("Josh Allen"), entry("Jahmyr Gibbs"), entry("Broncos D/ST")],
      players,
      "OVERALL"
    );
    expect(res.unmatched).toHaveLength(0);
    expect(res.matched.map((m) => m.player.id).sort()).toEqual(["4", "5", "6"]);
  });
});
