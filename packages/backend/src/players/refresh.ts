import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AdpFile, ParsedEntry, Player, Position, ScoringFormat } from "@drafthelper/shared";
import { canonicalTeamAbbrev, espnProTeamAbbrev, matchEntries, normalizeName } from "@drafthelper/shared";
import { fetchEspnAdp, fetchFfcAdp } from "../adp/fetch.js";

const SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
/** Our scoring format -> FFC's format slug. */
const FFC_FORMATS: Record<ScoringFormat, string> = {
  STD: "standard",
  HALF: "half-ppr",
  PPR: "ppr",
};

// ESPN's player universe — authoritative source of ESPN player ids. Sleeper's
// espn_id crossref is missing for most recent players and all defenses (~21%
// coverage), which silently drops most live-draft picks, so we build the id
// map by matching ESPN's own list to our players by name+position instead.
const ESPN_PLAYERS_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/players?view=players_wl";
const ESPN_POSITION: Record<number, Position> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

interface EspnPlayer {
  id: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
}

/** Key for name+position lookup, so two players with the same name at
 *  different positions don't collide. */
function nameKey(name: string, position: Position): string {
  return `${position}|${normalizeName(name)}`;
}

/**
 * Fetches ESPN's player universe and returns lookups for attaching ESPN ids:
 * offensive players by name+position, defenses by team abbreviation.
 */
async function loadEspnIdMaps(): Promise<{
  byName: Map<string, number>;
  dstByTeam: Map<string, number>;
}> {
  const res = await fetch(ESPN_PLAYERS_URL, {
    headers: { "x-fantasy-filter": JSON.stringify({ players: { limit: 12000 } }) },
  });
  if (!res.ok) throw new Error(`ESPN players fetch failed: ${res.status}`);
  const list = (await res.json()) as EspnPlayer[];

  const byName = new Map<string, number>();
  const dstByTeam = new Map<string, number>();
  for (const p of list) {
    const position = ESPN_POSITION[p.defaultPositionId ?? -1];
    if (!position) continue;
    if (position === "DST") {
      const abbrev = espnProTeamAbbrev(p.proTeamId ?? -1);
      if (abbrev) dstByTeam.set(abbrev, p.id);
    } else if (p.fullName) {
      // First writer wins: the list is roughly ownership/relevance-ordered,
      // so the active starter beats a same-named practice-squad player.
      const key = nameKey(p.fullName, position);
      if (!byName.has(key)) byName.set(key, p.id);
    }
  }
  return { byName, dstByTeam };
}

interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string | null;
  active?: boolean;
  espn_id?: number | null;
}

const s3 = new S3Client({});

/**
 * Weekly (or manually invoked) refresh: Sleeper's full player dump is ~14 MB
 * and they ask that it be fetched at most about once a day, so it is trimmed
 * server-side to the ~1-2K fantasy-relevant players and published as a static
 * asset the frontend loads once.
 */
export async function handler(): Promise<{ count: number }> {
  const bucket = process.env.SITE_BUCKET;
  if (!bucket) throw new Error("SITE_BUCKET not set");

  const [res, espnMaps] = await Promise.all([fetch(SLEEPER_URL), loadEspnIdMaps()]);
  if (!res.ok) throw new Error(`Sleeper fetch failed: ${res.status}`);
  const raw = (await res.json()) as Record<string, SleeperPlayer>;

  const players: Player[] = [];
  let espnMatched = 0;
  for (const p of Object.values(raw)) {
    if (!p.position || !FANTASY_POSITIONS.has(p.position)) continue;
    // Team defenses (position DEF, id = team abbr) have no `active` flag;
    // individual players must be active AND rostered to make the cut.
    const isTeamDefense = p.position === "DEF";
    if (!isTeamDefense && (!p.active || !p.team)) continue;
    const name =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!name) continue;
    const position = (isTeamDefense ? "DST" : p.position) as Position;
    const team = p.team ?? (isTeamDefense ? p.player_id : null);
    // ESPN id from ESPN's own list (by team for DST, by name+position
    // otherwise); fall back to Sleeper's sparse crossref.
    const fromEspn = isTeamDefense
      ? team
        ? espnMaps.dstByTeam.get(canonicalTeamAbbrev(team))
        : undefined
      : espnMaps.byName.get(nameKey(name, position));
    const espnId = fromEspn ?? p.espn_id ?? null;
    if (espnId != null) espnMatched++;
    players.push({ id: p.player_id, name, position, team, espnId });
  }

  console.log(
    `players: ${players.length}, espnId attached: ${espnMatched} (${Math.round(
      (100 * espnMatched) / players.length
    )}%)`
  );

  if (players.length < 500) {
    // A suspiciously small result means Sleeper changed shape; keep the old file.
    throw new Error(`only ${players.length} players parsed; not overwriting`);
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "players.json",
      Body: JSON.stringify({ updatedAt: new Date().toISOString(), players }),
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    })
  );

  // ADP is a best-effort secondary artifact: never let a flaky ESPN/FFC fetch
  // break the critical players.json refresh above.
  try {
    await publishAdp(bucket, players);
  } catch (err) {
    console.error("ADP refresh failed (players.json still published):", err);
  }

  return { count: players.length };
}

const ADP_SEASON = Number(process.env.ADP_SEASON ?? new Date().getFullYear());

/** Fetches ESPN + FFC ADP, maps both onto Sleeper ids, publishes adp.json. */
async function publishAdp(bucket: string, players: Player[]): Promise<void> {
  const [espnByEspnId, ffcByFormat] = await Promise.all([
    fetchEspnAdp(ADP_SEASON),
    Promise.all(
      (Object.entries(FFC_FORMATS) as [ScoringFormat, string][]).map(
        async ([scoring, slug]) => [scoring, await fetchFfcAdp(slug, ADP_SEASON)] as const
      )
    ),
  ]);

  // ESPN -> Sleeper by id (already crossref'd on each player).
  const espn: Record<string, number> = {};
  for (const p of players) {
    const adp = p.espnId != null ? espnByEspnId.get(p.espnId) : undefined;
    if (adp != null) espn[p.id] = adp;
  }

  // FFC -> Sleeper by name, reusing the import matcher against the full pool.
  const ffc = { STD: {}, HALF: {}, PPR: {} } as Record<ScoringFormat, Record<string, number>>;
  for (const [scoring, entries] of ffcByFormat) {
    const parsed: ParsedEntry[] = entries.map((e, i) => ({ name: e.name, rank: i, tier: 1 }));
    const { matched } = matchEntries(parsed, players, "OVERALL");
    for (const m of matched) ffc[scoring][m.player.id] = entries[m.entry.rank]!.adp;
  }

  const espnCount = Object.keys(espn).length;
  const ffcCount = Object.keys(ffc.PPR).length;
  console.log(`ADP: espn ${espnCount}, ffc(ppr) ${ffcCount}`);
  if (espnCount === 0 && ffcCount === 0) {
    throw new Error("both ADP sources empty; not overwriting adp.json");
  }

  const file: AdpFile = { updatedAt: new Date().toISOString(), espn, ffc };
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "adp.json",
      Body: JSON.stringify(file),
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    })
  );
}
