import type { ParsedEntry } from "../types.js";
import {
  detectDelimiter,
  isJunkName,
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
  const offset = leadingIndexOffset(
    header,
    lines.slice(1, 3).map((l) => splitCsvLine(l, delimiter)),
    nameCol
  );

  const entries: ParsedEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line, delimiter);
    const name = fields[nameCol + offset]?.trim();
    if (!name || isJunkName(name)) continue;
    const rank = rankCol >= 0 ? Number(fields[rankCol + offset]) : NaN;
    const tier = tierCol >= 0 ? Number(fields[tierCol + offset]) : NaN;
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: Number.isFinite(tier) ? tier : 1,
    });
  }
  return entries;
}

/** Plain ranked lines: "1. Player Name", "12 Player Name", or bare names. */
function parsePlainLines(content: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)[.)\s]\s*(.+)$/);
    const name = (m ? m[2]! : trimmed).trim();
    // Skip a header line a single-column file would otherwise donate as a player.
    if (!name || /^(rank|rk|tier|player|name|pos|position|team)\b/i.test(name)) continue;
    if (isJunkName(name)) continue;
    entries.push({ name, rank: entries.length + 1, tier: 1 });
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
