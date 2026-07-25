/**
 * Read-only ESPN fantasy API client, used for "test connection" and the
 * post-draft import. Live drafts are NOT readable here (verified 2026-07-24:
 * mDraftDetail only populates after the draft completes); live sync comes
 * from the browser extension instead. Cookie values must never be logged.
 */

const ESPN_API_BASE =
  process.env.ESPN_API_BASE ??
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface EspnAuth {
  espnS2: string;
  swid: string;
}

export interface EspnDraftPick {
  espnPlayerId: number;
  teamId: number;
  overall: number;
}

async function espnGet(
  leagueId: string,
  season: number,
  view: string,
  auth: EspnAuth
): Promise<unknown | null> {
  const url = `${ESPN_API_BASE}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}?view=${view}`;
  const res = await fetch(url, {
    headers: {
      cookie: `espn_s2=${auth.espnS2}; SWID=${auth.swid}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) return null;
  // A 200 with a non-JSON body (ESPN interstitial/HTML) must degrade to null so
  // callers return the intended 502, not an unhandled 500.
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Proves the stored cookies work by fetching the league's name. */
export async function fetchLeagueName(
  leagueId: string,
  season: number,
  auth: EspnAuth
): Promise<string | null> {
  const json = (await espnGet(leagueId, season, "mSettings", auth)) as {
    settings?: { name?: string };
  } | null;
  return json?.settings?.name ?? null;
}

/**
 * Fetches the completed draft's picks. Returns null on auth/HTTP failure,
 * and drafted=false with no picks while the draft hasn't finished.
 */
export async function fetchCompletedDraft(
  leagueId: string,
  season: number,
  auth: EspnAuth
): Promise<{ drafted: boolean; picks: EspnDraftPick[] } | null> {
  const json = (await espnGet(leagueId, season, "mDraftDetail", auth)) as {
    draftDetail?: {
      drafted?: boolean;
      picks?: { playerId?: number; teamId?: number; overallPickNumber?: number }[];
    };
  } | null;
  if (!json?.draftDetail) return null;
  const drafted = json.draftDetail.drafted === true;
  if (!drafted) return { drafted: false, picks: [] };
  const picks = (json.draftDetail.picks ?? [])
    .filter((p) => typeof p.playerId === "number" && p.playerId !== -1 && p.playerId !== 0)
    .map((p) => ({
      espnPlayerId: p.playerId!,
      teamId: p.teamId ?? 0,
      overall: p.overallPickNumber ?? 0,
    }));
  return { drafted, picks };
}
