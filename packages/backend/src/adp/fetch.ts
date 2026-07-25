/**
 * Fetches Average Draft Position from two free, no-auth sources:
 *  - ESPN — one market ADP per player, keyed by ESPN player id (which we
 *    already crossref to Sleeper ids), reflecting real ESPN drafts.
 *  - Fantasy Football Calculator — ADP per scoring format, by name/team.
 * Both are read-only public endpoints; used by the refresh Lambda.
 */

const ESPN_BASE =
  process.env.ESPN_API_BASE ??
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
// leaguedefaults/3 populates `ownership.averageDraftPosition`; ESPN exposes a
// single ADP number (not per-format), so we fetch it once.
const ESPN_LEAGUE_DEFAULT = 3;

const FFC_BASE = "https://fantasyfootballcalculator.com/api/v1/adp";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** ESPN player id -> market ADP (overall pick number). */
export async function fetchEspnAdp(season: number): Promise<Map<number, number>> {
  // kona_player_info returns 400 without a sortDraftRanks clause in the filter.
  const filter = {
    players: {
      limit: 700,
      sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "PPR" },
    },
  };
  const res = await fetch(
    `${ESPN_BASE}/seasons/${season}/segments/0/leaguedefaults/${ESPN_LEAGUE_DEFAULT}?view=kona_player_info`,
    { headers: { "x-fantasy-filter": JSON.stringify(filter), "user-agent": USER_AGENT } }
  );
  if (!res.ok) throw new Error(`ESPN ADP fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    players?: { id?: number; player?: { ownership?: { averageDraftPosition?: number } } }[];
  };
  const map = new Map<number, number>();
  for (const p of json.players ?? []) {
    const adp = p.player?.ownership?.averageDraftPosition;
    if (typeof p.id === "number" && typeof adp === "number" && adp > 0) map.set(p.id, adp);
  }
  return map;
}

export interface FfcAdpEntry {
  name: string;
  position: string;
  team: string;
  adp: number;
}

/** FFC ADP for one scoring format (their format slugs: standard | half-ppr | ppr). */
export async function fetchFfcAdp(format: string, season: number): Promise<FfcAdpEntry[]> {
  const res = await fetch(`${FFC_BASE}/${format}?teams=12&year=${season}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`FFC ADP fetch failed (${format}): ${res.status}`);
  const json = (await res.json()) as {
    players?: { name?: string; position?: string; team?: string; adp?: number }[];
  };
  return (json.players ?? [])
    .filter((p) => typeof p.name === "string" && typeof p.adp === "number" && p.adp > 0)
    .map((p) => ({
      name: p.name!,
      position: p.position ?? "",
      team: p.team ?? "",
      adp: p.adp!,
    }));
}
