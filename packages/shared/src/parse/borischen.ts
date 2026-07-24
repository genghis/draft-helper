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

/** Minimal quote-aware CSV line splitter. */
export function splitCsvLine(line: string): string[] {
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
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Parses the fftiers weekly-*.csv shape: Rank, Player.Name, ..., Tier. */
export function parseBorisChenCsv(csv: string): ParsedEntry[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const rankCol = header.indexOf("rank");
  const nameCol = header.indexOf("player.name");
  const tierCol = header.indexOf("tier");
  if (nameCol === -1) return [];

  const entries: ParsedEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const name = fields[nameCol]?.trim();
    if (!name) continue;
    const rank = Number(fields[rankCol] ?? NaN);
    const tier = Number(fields[tierCol] ?? NaN);
    entries.push({
      name,
      rank: Number.isFinite(rank) ? rank : entries.length + 1,
      tier: Number.isFinite(tier) ? tier : 1,
    });
  }
  return entries;
}
