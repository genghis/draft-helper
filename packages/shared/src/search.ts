import { normalizeName } from "./normalize.js";
import type { Player } from "./types.js";

const DEFAULT_LIMIT = 8;
/** Queries shorter than this (normalized) return nothing — too easy to mis-mark. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Type-ahead player search for draft-day marking. Match quality:
 * full-name prefix > per-token prefixes > substring. Ties break toward
 * board-ranked players (lower rank value = better), then alphabetically,
 * so the top hit is the player you most likely mean.
 */
export function searchPlayers(
  query: string,
  players: Player[],
  rankById?: ReadonlyMap<string, number>,
  limit = DEFAULT_LIMIT,
  /**
   * Optional precomputed normalizeName(player.name) by id. normalizeName does
   * an NFD pass plus several regexes, so recomputing it for the whole player
   * universe on every keystroke is the dominant cost in a type-ahead over
   * thousands of players. Callers that search repeatedly against a stable list
   * should build this once (see buildNameIndex).
   */
  normalizedById?: ReadonlyMap<string, string>
): Player[] {
  const q = normalizeName(query);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const qTokens = q.split(" ");

  const scored: { player: Player; score: number; rank: number }[] = [];
  for (const player of players) {
    const n = normalizedById?.get(player.id) ?? normalizeName(player.name);
    let score: number;
    if (n.startsWith(q)) score = 0;
    else if (tokensPrefix(qTokens, n.split(" "))) score = 1;
    else if (q.length >= 3 && n.includes(q)) score = 2;
    else continue;
    scored.push({ player, score, rank: rankById?.get(player.id) ?? Number.MAX_SAFE_INTEGER });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score || a.rank - b.rank || a.player.name.localeCompare(b.player.name)
  );
  return scored.slice(0, limit).map((s) => s.player);
}

/** Every query token prefixes its own player-name token, in order ("ja ch" -> "jamarr chase"). */
function tokensPrefix(qTokens: string[], nameTokens: string[]): boolean {
  let i = 0;
  for (const qt of qTokens) {
    while (i < nameTokens.length && !nameTokens[i]!.startsWith(qt)) i++;
    if (i === nameTokens.length) return false;
    i++;
  }
  return true;
}

/** Precomputes normalized names for repeated searches over a stable player list. */
export function buildNameIndex(players: Player[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const player of players) index.set(player.id, normalizeName(player.name));
  return index;
}
