import type {
  BoardPosition,
  MatchCandidate,
  MatchResult,
  ParsedEntry,
  Player,
} from "./types.js";
import { canonicalTeamAbbrev } from "./espnPicks.js";

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const MAX_CANDIDATES = 5;

/** "De'Von Achane Jr." -> "devon achane"; diacritics, punctuation, suffixes gone. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[/-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + cost);
      diagonal = prev[j]!;
      prev[j] = next;
    }
  }
  return prev[b.length]!;
}

/** "ken walker" ≈ "kenneth walker": same last tokens, one first token prefixes the other. */
function isNicknameVariant(a: string, b: string): boolean {
  const at = a.split(" ");
  const bt = b.split(" ");
  if (at.length < 2 || bt.length < 2) return false;
  if (at.slice(1).join(" ") !== bt.slice(1).join(" ")) return false;
  const [af, bf] = [at[0]!, bt[0]!];
  const [shorter, longer] = af.length <= bf.length ? [af, bf] : [bf, af];
  return shorter.length >= 3 && longer.startsWith(shorter);
}

function poolFor(position: BoardPosition, players: Player[]): Player[] {
  if (position === "OVERALL") return players;
  if (position === "FLX") return players.filter((p) => FLEX_POSITIONS.has(p.position));
  return players.filter((p) => p.position === position);
}

/** A row that looks like a team defense ("Broncos D/ST", "49ers DST"). */
function looksLikeDst(normalized: string): boolean {
  return /\b(d st|dst|defense)\b/.test(normalized);
}

/**
 * Narrows a candidate set using the position/team a row declared, when it
 * declared any. Only ever narrows to a NON-empty set: a stale team on an
 * otherwise-correct row must not throw the match away, and a source's idea of
 * where a player plays is weaker evidence than the name itself.
 */
function refine(candidates: Player[], entry: ParsedEntry): Player[] {
  let out = candidates;
  if (entry.position) {
    const byPos = out.filter((p) => p.position === entry.position);
    if (byPos.length > 0) out = byPos;
  }
  if (entry.team) {
    const want = canonicalTeamAbbrev(entry.team);
    const byTeam = out.filter((p) => p.team && canonicalTeamAbbrev(p.team) === want);
    if (byTeam.length > 0) out = byTeam;
  }
  return out;
}

/**
 * Match parsed source rows against the canonical player list:
 * exact normalized name -> nickname variant -> unambiguous 1-edit typo ->
 * DST mascot fallback -> human review with ranked candidates.
 */
export function matchEntries(
  entries: ParsedEntry[],
  players: Player[],
  position: BoardPosition
): MatchResult {
  const pool = poolFor(position, players);
  const byName = new Map<string, Player[]>();
  for (const p of pool) {
    const key = normalizeName(p.name);
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }

  const result: MatchResult = { matched: [], unmatched: [] };

  for (const entry of entries) {
    const norm = normalizeName(entry.name);

    const exact = byName.get(norm) ?? [];
    if (exact.length === 1) {
      result.matched.push({ entry, player: exact[0]! });
      continue;
    }
    if (exact.length > 1) {
      // Two players really do share a name; the row's own position/team can
      // settle it without sending the user to a dropdown.
      const refined = refine(exact, entry);
      if (refined.length === 1) {
        result.matched.push({ entry, player: refined[0]! });
        continue;
      }
      result.unmatched.push({
        entry,
        candidates: refined.map((player) => ({ player, distance: 0 })),
      });
      continue;
    }

    const nickname = pool.filter((p) => isNicknameVariant(norm, normalizeName(p.name)));
    if (nickname.length === 1) {
      result.matched.push({ entry, player: nickname[0]! });
      continue;
    }
    if (nickname.length > 1) {
      const refined = refine(nickname, entry);
      if (refined.length === 1) {
        result.matched.push({ entry, player: refined[0]! });
        continue;
      }
    }

    // DST rows often arrive as "Broncos D/ST" or bare mascots; match on the
    // mascot token against team-defense names ("Denver Broncos"). Fires for a
    // DST-scoped list, or for a DST-looking row inside an OVERALL list.
    if (position === "DST" || (position === "OVERALL" && looksLikeDst(norm))) {
      const mascot = norm.replace(/\b(d st|dst|defense)\b/g, "").trim().split(" ").pop() ?? "";
      const byMascot = pool.filter(
        (p) => p.position === "DST" && normalizeName(p.name).endsWith(` ${mascot}`)
      );
      if (mascot && byMascot.length === 1) {
        result.matched.push({ entry, player: byMascot[0]! });
        continue;
      }
    }

    // Fuzzy matching searches only the plausible players when the row says
    // where they play, so a WR typo can never resolve to a similarly-spelled QB.
    const searchPool = entry.position || entry.team ? refine(pool, entry) : pool;
    const scored: MatchCandidate[] = searchPool
      .map((player) => ({ player, distance: levenshtein(norm, normalizeName(player.name)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_CANDIDATES);

    const [best, second] = scored;
    if (best && best.distance <= 1 && (!second || second.distance >= best.distance + 2)) {
      result.matched.push({ entry, player: best.player });
      continue;
    }

    result.unmatched.push({ entry, candidates: scored });
  }

  return result;
}
