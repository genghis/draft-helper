import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Player, Position } from "@drafthelper/shared";

const SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl";
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

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

  const res = await fetch(SLEEPER_URL);
  if (!res.ok) throw new Error(`Sleeper fetch failed: ${res.status}`);
  const raw = (await res.json()) as Record<string, SleeperPlayer>;

  const players: Player[] = [];
  for (const p of Object.values(raw)) {
    if (!p.position || !FANTASY_POSITIONS.has(p.position)) continue;
    // Team defenses (position DEF, id = team abbr) have no `active` flag;
    // individual players must be active AND rostered to make the cut.
    const isTeamDefense = p.position === "DEF";
    if (!isTeamDefense && (!p.active || !p.team)) continue;
    const name =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!name) continue;
    players.push({
      id: p.player_id,
      name,
      position: (isTeamDefense ? "DST" : p.position) as Position,
      team: p.team ?? (isTeamDefense ? p.player_id : null),
      espnId: p.espn_id ?? null,
    });
  }

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

  return { count: players.length };
}
