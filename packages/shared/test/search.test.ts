import { describe, expect, it } from "vitest";
import { matchesPosition, searchPlayers } from "../src/search.js";
import type { Player } from "../src/types.js";

const players: Player[] = [
  { id: "1", name: "Ja'Marr Chase", position: "WR", team: "CIN", espnId: 101 },
  { id: "2", name: "Jahmyr Gibbs", position: "RB", team: "DET", espnId: 102 },
  { id: "3", name: "Jaylen Waddle", position: "WR", team: "MIA", espnId: 103 },
  { id: "4", name: "Josh Allen", position: "QB", team: "BUF", espnId: 104 },
  { id: "5", name: "Josh Jacobs", position: "RB", team: "GB", espnId: 105 },
  { id: "6", name: "Amon-Ra St. Brown", position: "WR", team: "DET", espnId: 106 },
  { id: "7", name: "Marvin Harrison Jr.", position: "WR", team: "ARI", espnId: 107 },
  { id: "8", name: "CeeDee Lamb", position: "WR", team: "DAL", espnId: 108 },
];

describe("searchPlayers", () => {
  it("returns nothing for queries under the minimum length", () => {
    expect(searchPlayers("j", players)).toEqual([]);
    expect(searchPlayers("", players)).toEqual([]);
  });

  it("prefers full-name prefix over token prefix over substring", () => {
    const hits = searchPlayers("ja", players);
    // Full-prefix matches (Ja'Marr, Jahmyr, Jaylen) come before Josh Jacobs (token prefix).
    expect(hits.slice(0, 3).map((p) => p.name)).toContain("Ja'Marr Chase");
    expect(hits.map((p) => p.name)).toContain("Josh Jacobs");
    expect(hits.findIndex((p) => p.name === "Josh Jacobs")).toBeGreaterThan(2);
  });

  it("matches multi-token prefixes in order", () => {
    expect(searchPlayers("ja ch", players)[0]?.name).toBe("Ja'Marr Chase");
    expect(searchPlayers("mar har", players)[0]?.name).toBe("Marvin Harrison Jr.");
  });

  it("matches punctuated names through normalization", () => {
    expect(searchPlayers("jamarr", players)[0]?.name).toBe("Ja'Marr Chase");
    expect(searchPlayers("amon ra", players)[0]?.name).toBe("Amon-Ra St. Brown");
  });

  it("matches by substring for longer queries", () => {
    expect(searchPlayers("lamb", players).map((p) => p.name)).toContain("CeeDee Lamb");
  });

  it("breaks ties toward board-ranked players", () => {
    const rank = new Map([
      ["5", 20], // Josh Jacobs on a board
      ["4", 90], // Josh Allen ranked worse
    ]);
    expect(searchPlayers("jos", players, rank)[0]?.name).toBe("Josh Jacobs");
    const reversed = new Map([
      ["4", 5],
      ["5", 50],
    ]);
    expect(searchPlayers("jos", players, reversed)[0]?.name).toBe("Josh Allen");
  });

  it("caps results at the limit", () => {
    expect(searchPlayers("ja", players, undefined, 2)).toHaveLength(2);
  });
});

describe("matchesPosition", () => {
  it("treats an empty selection as no filter", () => {
    expect(matchesPosition("RB", new Set())).toBe(true);
    expect(matchesPosition(undefined, new Set())).toBe(true);
  });

  it("passes only the selected positions", () => {
    const sel = new Set(["RB", "WR"] as const);
    expect(matchesPosition("RB", sel)).toBe(true);
    expect(matchesPosition("WR", sel)).toBe(true);
    expect(matchesPosition("QB", sel)).toBe(false);
  });

  it("excludes a player with no known position once a filter is active", () => {
    // Only when filtering: an unknown position must not masquerade as a match.
    expect(matchesPosition(undefined, new Set(["RB"] as const))).toBe(false);
  });
});
