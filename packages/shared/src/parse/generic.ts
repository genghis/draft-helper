import type { ParsedEntry, Position } from "../types.js";
import { isTeamAbbrev } from "../espnPicks.js";
import { unflipName } from "../normalize.js";
import {
  detectDelimiter,
  isJunkName,
  parsePositionCell,
  leadingIndexOffset,
  parseBorisChenCsv,
  parseBorisChenText,
  splitCsvLine,
} from "./borischen.js";

function headerIndex(header: string[], patterns: RegExp[]): number {
  return header.findIndex((h) => patterns.some((p) => p.test(h)));
}


/** Generic CSV with a header row naming a player/name column. */
function parseHeaderedCsv(content: string): ParsedEntry[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]!);
  if (!lines[0]!.includes(delimiter)) return [];
  const header = splitCsvLine(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());
  const nameCol = headerIndex(header, [/player/, /^name$/]);
  if (nameCol === -1) return [];
  const rankCol = headerIndex(header, [/^(rank|rk|overall|ovr)$/]);
  const tierCol = headerIndex(header, [/tier/]);
  // Sources routinely publish these and we used to drop them; matchEntries
  // uses them to settle same-name collisions without asking the user.
  const posCol = headerIndex(header, [/^(pos|position)$/]);
  const teamCol = headerIndex(header, [/^(team|tm)$/]);
  const offset = leadingIndexOffset(
    header,
    lines.slice(1, 3).map((l) => splitCsvLine(l, delimiter)),
    nameCol
  );

  const entries: ParsedEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line, delimiter);
    const cell = fields[nameCol + offset]?.trim();
    const name = cell ? unflipName(cell) : cell;
    if (!name || isJunkName(name)) continue;
    const rank = rankCol >= 0 ? Number(fields[rankCol + offset]) : NaN;
    const tier = tierCol >= 0 ? Number(fields[tierCol + offset]) : NaN;
    const position = posCol >= 0 ? parsePositionCell(fields[posCol + offset]) : undefined;
    const team = teamCol >= 0 ? fields[teamCol + offset]?.trim() : undefined;
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: Number.isFinite(tier) ? tier : 1,
      ...(position ? { position } : {}),
      ...(team ? { team } : {}),
    });
  }
  return entries;
}

/**
 * A ranked line, in the shapes people actually paste:
 *
 *   1. Bijan Robinson, ATL (RB1)   rank, name, team, position + positional rank
 *   1. Bijan Robinson, ATL         rank, name, team
 *   1. Bijan Robinson              rank, name
 *   Bijan Robinson                 name alone
 *
 * The trailing parenthetical is read for its position only; its number is the
 * source's positional rank, which we already derive from the overall order.
 */
const ANNOTATED_LINE =
  /^(.+?),\s*([A-Za-z]{2,4})\s*\(\s*([A-Za-z/]{1,4})\s*\d*\s*\)\s*$/;
/** "Name, TEAM" with no parenthetical. */
const TEAMED_LINE = /^(.+?),\s*([A-Za-z]{2,4})\s*$/;

/** Plain ranked lines: "1. Player Name", "12 Player Name", or bare names. */
function parsePlainLines(content: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)[.)\s]\s*(.+)$/);
    let rest = (m ? m[2]! : trimmed).trim();

    // Pull the annotations off before the junk check, so a row is judged on
    // the player's name rather than on the whole decorated line.
    let position: Position | undefined;
    let team: string | undefined;
    const annotated = rest.match(ANNOTATED_LINE);
    const teamed = annotated ? null : rest.match(TEAMED_LINE);
    if (annotated) {
      position = parsePositionCell(annotated[3]);
      // Only accept the split when the parenthetical really was a position;
      // "Smith, Jr. (see notes)" must stay one name.
      if (position) {
        if (isTeamAbbrev(annotated[2]!)) {
          rest = annotated[1]!.trim();
          team = annotated[2]!.toUpperCase();
        } else {
          // "Mahomes, Pat (QB1)" — the comma tail is a first name, not a
          // team; keep it with the name for unflipName below.
          rest = `${annotated[1]!.trim()}, ${annotated[2]!}`;
        }
      }
    } else if (
      teamed &&
      parsePositionCell(teamed[2]) === undefined &&
      isTeamAbbrev(teamed[2]!)
    ) {
      // A short tail is only a team when it is a real team abbreviation and
      // not a position label; "Allen, Josh" keeps its first name.
      rest = teamed[1]!.trim();
      team = teamed[2]!.toUpperCase();
    }

    const name = unflipName(rest);
    // Skip a header line a single-column file would otherwise donate as a player.
    if (!name || /^(rank|rk|tier|player|name|pos|position|team)\b/i.test(name)) continue;
    if (isJunkName(name)) continue;
    // Ranks come from the source when it numbered the lines. They are NOT
    // assumed unique: real lists repeat and skip numbers, and renumbering here
    // would quietly disagree with the list the user is reading from.
    const rank = m ? Number(m[1]) : entries.length + 1;
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: 1,
      ...(position ? { position } : {}),
      ...(team ? { team } : {}),
    });
  }
  return entries;
}

/**
 * One entry point for any pasted or fetched rankings content. Tries, in
 * order: Boris Chen tier text, Boris Chen CSV, generic headered CSV, plain
 * ranked lines.
 */
export function parseRankings(content: string): ParsedEntry[] {
  if (/^\s*Tier\s+\d+\s*:/im.test(content)) return parseBorisChenText(content);
  if (/player\.name/i.test(content)) return parseBorisChenCsv(content);
  const csv = parseHeaderedCsv(content);
  if (csv.length > 0) return csv;
  return parsePlainLines(content);
}
