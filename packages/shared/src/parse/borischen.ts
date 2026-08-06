import type { ParsedEntry } from "../types.js";

/** Parses "Tier 1: A, B, C" lines; rank is order of appearance. */
export function parseBorisChenText(text: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*Tier\s+(\d+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const tier = Number(m[1]);
    for (const name of m[2]!.split(",")) {
      const trimmed = name.trim();
      if (trimmed) entries.push({ name: trimmed, rank: entries.length + 1, tier });
    }
  }
  return entries;
}

export type Delimiter = "," | "\t";

/**
 * Picks the delimiter a header line actually uses. Ranking exports come as
 * both comma CSV (FantasyPros) and tab-separated (fftiers, which is R's
 * write.table output), and the two are indistinguishable by file extension —
 * both arrive named .csv. Whichever splits the header into more columns wins.
 */
export function detectDelimiter(headerLine: string): Delimiter {
  const commas = splitCsvLine(headerLine, ",").length;
  const tabs = splitCsvLine(headerLine, "\t").length;
  return tabs > commas ? "\t" : ",";
}

/** Minimal quote-aware delimited-line splitter. */
export function splitCsvLine(line: string, delimiter: Delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * How many unnamed columns precede the header's first column. R's write.table
 * emits row names with no header cell for them, so fftiers exports have one
 * more field per data row than per header row — every header index has to
 * shift right by that much or the row number gets read as the player name.
 */
export function leadingIndexOffset(headerFields: string[], firstDataFields: string[]): number {
  const extra = firstDataFields.length - headerFields.length;
  return extra > 0 ? extra : 0;
}

/** Parses the fftiers weekly-*.csv shape: Rank, Player.Name, ..., Tier. */
export function parseBorisChenCsv(csv: string): ParsedEntry[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const header = splitCsvLine(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());
  // fftiers has no plain "rank" column (only best/worst/avg) and carries the
  // rank in an unnamed first column, so rank falls back to row order below.
  const offset = leadingIndexOffset(header, splitCsvLine(lines[1]!, delimiter));
  const rankCol = header.indexOf("rank");
  const nameCol = header.indexOf("player.name");
  const tierCol = header.indexOf("tier");
  if (nameCol === -1) return [];

  const entries: ParsedEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line, delimiter);
    const name = fields[nameCol + offset]?.trim();
    if (!name) continue;
    const rank = Number(fields[rankCol + offset] ?? NaN);
    const tier = Number(fields[tierCol + offset] ?? NaN);
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: Number.isFinite(tier) ? tier : 1,
    });
  }
  return entries;
}
