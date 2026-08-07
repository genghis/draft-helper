import type { ExtPicksRequest } from "./types.js";

/**
 * ESPN encodes D/ST "players" as -(16000 + proTeamId). Sleeper's espn_id
 * crossref never covers those, so defenses map through team abbreviations.
 */
const ESPN_DST_OFFSET = -16000;

/** ESPN proTeamId -> NFL team abbreviation (canonicalized to Sleeper's forms). */
const ESPN_PRO_TEAMS: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

/** ESPN proTeamId -> canonical NFL team abbreviation, or null if unknown. */
export function espnProTeamAbbrev(proTeamId: number): string | null {
  const abbrev = ESPN_PRO_TEAMS[proTeamId];
  return abbrev ? canonicalTeamAbbrev(abbrev) : null;
}

const ABBREV_ALIASES: Record<string, string> = {
  WSH: "WAS",
  JAC: "JAX",
  OAK: "LV",
  LA: "LAR",
  SD: "LAC",
};

/** Normalize an NFL team abbreviation to its canonical form. */
export function canonicalTeamAbbrev(abbrev: string): string {
  const up = abbrev.toUpperCase();
  return ABBREV_ALIASES[up] ?? up;
}

const TEAM_ABBREVS = new Set([
  ...Object.values(ESPN_PRO_TEAMS),
  ...Object.keys(ABBREV_ALIASES),
]);

/** Whether a string is a known NFL team abbreviation (canonical or alias). */
export function isTeamAbbrev(abbrev: string): boolean {
  return TEAM_ABBREVS.has(abbrev.trim().toUpperCase());
}

export interface MappedEspnPick {
  playerId: string;
  mine: boolean;
  overall: number;
  /** The drafting ESPN team, kept so the running board can name who picked. */
  teamId: number;
}

export interface EspnPickMapResult {
  picks: MappedEspnPick[];
  /** ESPN player ids with no canonical-player mapping (reported, never dropped silently). */
  unmapped: number[];
}

/**
 * Maps ESPN draft picks onto canonical (Sleeper) player ids.
 * Positive ids go through the espn_id crossref; negative ids are D/ST and
 * map via team abbreviation.
 */
export function mapEspnPicks(
  espnIdToPlayerId: ReadonlyMap<number, string>,
  dstPlayerIdByTeam: ReadonlyMap<string, string>,
  request: ExtPicksRequest
): EspnPickMapResult {
  const picks: MappedEspnPick[] = [];
  const unmapped: number[] = [];
  for (const pick of request.picks) {
    const playerId =
      pick.espnPlayerId >= 0
        ? espnIdToPlayerId.get(pick.espnPlayerId)
        : dstPlayerIdByTeam.get(
            canonicalTeamAbbrev(
              ESPN_PRO_TEAMS[ESPN_DST_OFFSET - pick.espnPlayerId] ?? ""
            )
          );
    if (playerId === undefined) {
      unmapped.push(pick.espnPlayerId);
      continue;
    }
    picks.push({
      playerId,
      mine: pick.teamId === request.myTeamId,
      overall: pick.overall,
      teamId: pick.teamId,
    });
  }
  return { picks, unmapped };
}
