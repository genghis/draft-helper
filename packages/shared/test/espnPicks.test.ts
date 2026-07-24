import { describe, expect, it } from "vitest";
import { canonicalTeamAbbrev, mapEspnPicks } from "../src/espnPicks.js";

const espnIds = new Map([
  [3915511, "sleeper-jw"],
  [4362628, "sleeper-jg"],
]);
const dstByTeam = new Map([
  ["DEN", "sleeper-den-dst"],
  ["WAS", "sleeper-was-dst"],
]);

describe("mapEspnPicks", () => {
  it("maps positive ids through the espn_id crossref and computes mine", () => {
    const res = mapEspnPicks(espnIds, dstByTeam, {
      myTeamId: 4,
      picks: [
        { espnPlayerId: 3915511, overall: 1, teamId: 4 },
        { espnPlayerId: 4362628, overall: 2, teamId: 7 },
      ],
    });
    expect(res.picks).toEqual([
      { playerId: "sleeper-jw", mine: true, overall: 1 },
      { playerId: "sleeper-jg", mine: false, overall: 2 },
    ]);
    expect(res.unmapped).toEqual([]);
  });

  it("maps negative D/ST ids via team abbreviation", () => {
    // Broncos are ESPN proTeamId 7 -> D/ST id -16007 (observed in the WS spike).
    const res = mapEspnPicks(espnIds, dstByTeam, {
      myTeamId: 1,
      picks: [{ espnPlayerId: -16007, overall: 30, teamId: 1 }],
    });
    expect(res.picks).toEqual([
      { playerId: "sleeper-den-dst", mine: true, overall: 30 },
    ]);
  });

  it("bridges ESPN's WSH to Sleeper's WAS", () => {
    const res = mapEspnPicks(espnIds, dstByTeam, {
      myTeamId: 1,
      picks: [{ espnPlayerId: -16028, overall: 40, teamId: 2 }],
    });
    expect(res.picks[0]?.playerId).toBe("sleeper-was-dst");
  });

  it("reports unknown ids as unmapped without dropping the rest", () => {
    const res = mapEspnPicks(espnIds, dstByTeam, {
      myTeamId: 1,
      picks: [
        { espnPlayerId: 999999, overall: 1, teamId: 1 },
        { espnPlayerId: -16099, overall: 2, teamId: 1 },
        { espnPlayerId: 3915511, overall: 3, teamId: 2 },
      ],
    });
    expect(res.unmapped).toEqual([999999, -16099]);
    expect(res.picks).toHaveLength(1);
  });
});

describe("canonicalTeamAbbrev", () => {
  it("normalizes alias forms", () => {
    expect(canonicalTeamAbbrev("WSH")).toBe("WAS");
    expect(canonicalTeamAbbrev("jac")).toBe("JAX");
    expect(canonicalTeamAbbrev("KC")).toBe("KC");
  });
});
