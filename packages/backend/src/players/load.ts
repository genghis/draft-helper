import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Player } from "@drafthelper/shared";
import { canonicalTeamAbbrev } from "@drafthelper/shared";

const CACHE_TTL_MS = 15 * 60 * 1000;

const s3 = new S3Client({});

export interface PlayerMaps {
  /** ESPN player id -> canonical (Sleeper) player id. */
  espnIdToPlayerId: Map<number, string>;
  /** Canonical team abbreviation -> D/ST player id. */
  dstPlayerIdByTeam: Map<string, string>;
}

let cache: { maps: PlayerMaps; at: number } | null = null;

/** Loads players.json from the site bucket and builds the ESPN crossref maps. */
export async function getPlayerMaps(): Promise<PlayerMaps> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.maps;

  const bucket = process.env.SITE_BUCKET;
  if (!bucket) throw new Error("SITE_BUCKET not set");
  const res = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: "players.json" })
  );
  const body = await res.Body?.transformToString();
  if (!body) throw new Error("players.json is empty");
  const { players } = JSON.parse(body) as { players: Player[] };

  const espnIdToPlayerId = new Map<number, string>();
  const dstPlayerIdByTeam = new Map<string, string>();
  for (const p of players) {
    if (p.espnId != null) espnIdToPlayerId.set(p.espnId, p.id);
    if (p.position === "DST" && p.team) {
      dstPlayerIdByTeam.set(canonicalTeamAbbrev(p.team), p.id);
    }
  }

  cache = { maps: { espnIdToPlayerId, dstPlayerIdByTeam }, at: Date.now() };
  return cache.maps;
}
