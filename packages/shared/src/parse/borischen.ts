import type { ParsedEntry, Position } from "../types.js";
import { unflipName } from "../normalize.js";

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
 * Reads a position cell from a ranking export. Sources write it several ways:
 * bare ("RB"), with the positional rank attached ("RB1", "WR12" -- FantasyPros
 * does this), or as a defense ("DST", "D/ST"). Anything unrecognised yields
 * undefined rather than a guess, since a wrong position now vetoes matches.
 */
export function parsePositionCell(cell: string | undefined): Position | undefined {
  if (!cell) return undefined;
  const bare = cell.trim().toUpperCase().replace(/\d+$/, "");
  const map: Record<string, Position> = {
    QB: "QB",
    RB: "RB",
    WR: "WR",
    TE: "TE",
    K: "K",
    PK: "K",
    DST: "DST",
    "D/ST": "DST",
    DEF: "DST",
  };
  return map[bare];
}

/** Position-rank labels ("TE19", "D/ST") and anything with no letters at all. */
const POSITION_RANK = /^(qb|rb|wr|te|k|pk|dst|d\/st|dl|lb|db|idp|flx|flex|sflx)\s*\d*$/i;

/**
 * Rows that are not player names. A row number, a position label, a bare
 * figure — fuzzy matching will happily land any of them on a real player, so
 * they must never reach the matcher. Both CSV parsers share this: the fftiers
 * parser is the one most likely to meet a row-index column, and it previously
 * had no guard at all, so a shifted column silently produced 200 players named
 * "1", "2", "3".
 */
export function isJunkName(name: string): boolean {
  return !/[a-z]/i.test(name) || POSITION_RANK.test(name);
}

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
 * Whether an export has an unnamed leading row-index column, as R's
 * write.table emits: data rows carry one more field than the header, and the
 * extra one is a row number.
 *
 * Requiring the extra field to actually BE consecutive row numbers matters.
 * A trailing delimiter — which plenty of spreadsheet exports emit — also
 * yields one more field per data row, and treating that as a leading index
 * shifts every column, lands the name on a number, and drops the whole file.
 * Two rows are checked so a leading "1" in a genuine first column can't fake it.
 */
export function leadingIndexOffset(
  headerFields: string[],
  dataRows: string[][],
  /** Column the name will be read from, so the inferred shift can be sanity-checked. */
  nameCol?: number
): number {
  const first = dataRows[0];
  if (!first || first.length - headerFields.length !== 1) return 0;
  // A trailing delimiter also yields one extra field, and its first column is
  // often a rank -- so "consecutive integers" alone cannot tell the two apart.
  // The extra field's position is what separates them: a trailing delimiter
  // leaves the LAST field empty, a leading row index does not.
  if (first[first.length - 1]!.trim() === "") return 0;
  const n = Number(first[0]);
  if (!Number.isInteger(n)) return 0;
  const second = dataRows[1];
  // A single data row can't prove a sequence; accept it only if it starts at 1.
  const offset = !second
    ? n === 1
      ? 1
      : 0
    : second.length === first.length && Number(second[0]) === n + 1
      ? 1
      : 0;
  // Last check: the shift has to actually produce a name. An unnamed but
  // non-empty trailing column looks identical to a leading index by field
  // count, and only this catches it.
  if (offset > 0 && nameCol !== undefined) {
    const candidate = first[nameCol + offset]?.trim() ?? "";
    if (isJunkName(candidate)) return 0;
  }
  return offset;
}

/** Parses the fftiers weekly-*.csv shape: Rank, Player.Name, ..., Tier. */
export function parseBorisChenCsv(csv: string): ParsedEntry[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0]!);
  const header = splitCsvLine(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());
  // fftiers has no plain "rank" column (only best/worst/avg) and carries the
  // rank in an unnamed first column, so rank falls back to row order below.
  const rankCol = header.indexOf("rank");
  const nameCol = header.indexOf("player.name");
  const tierCol = header.indexOf("tier");
  const posCol = header.indexOf("position");
  if (nameCol === -1) return [];
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
    // indexOf returns -1 when a column is absent; adding the offset to that
    // sentinel would silently read column 0 (the row index) as rank or tier.
    const rank = rankCol >= 0 ? Number(fields[rankCol + offset]) : NaN;
    const tier = tierCol >= 0 ? Number(fields[tierCol + offset]) : NaN;
    const position = posCol >= 0 ? parsePositionCell(fields[posCol + offset]) : undefined;
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: Number.isFinite(tier) ? tier : 1,
      ...(position ? { position } : {}),
    });
  }
  return entries;
}
