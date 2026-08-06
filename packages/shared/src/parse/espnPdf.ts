import type { ParsedEntry, Position } from "../types.js";

/** ESPN writes D/ST rows as "Jets D/ST, NYJ"; everything else is a person. */
const POSITIONS: Record<string, Position> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DST: "DST",
  "D/ST": "DST",
};

/** "12. (RB4)" — overall rank plus the positional rank, which we only use for the position. */
const RANK_LINE = /^(\d+)\.\s*\(([A-Z/]{1,4})\d+\)$/;
/** "Jahmyr Gibbs, DET" */
const NAME_LINE = /^(.+?),\s*([A-Z]{2,4})$/;

/**
 * Parses ESPN's printable rankings PDF from its extracted text lines.
 *
 * The caller does the extraction (pdf.js in the browser) and passes the text
 * items in reading order; this stays a pure function so it can be tested
 * against a captured fixture without a PDF engine.
 *
 * Two things about the format matter. The page is laid out in four columns, so
 * reading order interleaves ranks (1, 81, 161, 241, 2, 82, ...) — harmless,
 * because every row carries its own rank and we sort at the end. And the
 * export has no tiers at all, so every entry lands in tier 1.
 */
export interface EspnPdfResult {
  entries: ParsedEntry[];
  /** Ranks between 1 and the highest seen that produced no entry. */
  missingRanks: number[];
}

/**
 * As parseEspnPdfLines, but reporting the ranks it could not recover.
 *
 * pdf.js splits text items on font and glyph changes, so a layout tweak or a
 * library bump can break the rank/name adjacency this relies on for some rows
 * and not others. That failure is silent and looks like a shorter list, which
 * is exactly the kind of plausible-but-wrong output the caller must be able to
 * refuse rather than import.
 */
export function parseEspnPdf(lines: string[]): EspnPdfResult {
  const entries = parseEspnPdfLines(lines);
  const seen = new Set(entries.map((e) => e.rank));
  const highest = entries.length > 0 ? Math.max(...seen) : 0;
  const missingRanks: number[] = [];
  for (let r = 1; r <= highest; r++) if (!seen.has(r)) missingRanks.push(r);
  return { entries, missingRanks };
}

export function parseEspnPdfLines(lines: string[]): ParsedEntry[] {
  const byRank = new Map<number, ParsedEntry>();

  for (let i = 0; i < lines.length - 1; i++) {
    const head = RANK_LINE.exec(lines[i]!.trim());
    if (!head) continue;
    // Look a couple of items ahead: pdf.js can emit a stray fragment between
    // the rank and the name when glyphs or fonts change mid-line.
    let body: RegExpExecArray | null = null;
    for (let j = i + 1; j <= i + 3 && j < lines.length && !body; j++) {
      if (RANK_LINE.test(lines[j]!.trim())) break;
      body = NAME_LINE.exec(lines[j]!.trim());
    }
    if (!body) continue;

    const rank = Number(head[1]);
    const position = POSITIONS[head[2]!.toUpperCase()];
    const name = body[1]!.trim();
    if (!name || !Number.isFinite(rank)) continue;

    // First occurrence wins: a repeated header line re-emits rank 1.
    if (byRank.has(rank)) continue;
    byRank.set(rank, {
      name,
      rank,
      tier: 1,
      ...(position ? { position } : {}),
      team: body[2]!,
    });
  }

  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

/** Whether extracted text looks like ESPN's rankings PDF rather than some other document. */
export function looksLikeEspnPdf(lines: string[]): boolean {
  let hits = 0;
  for (const line of lines) {
    if (RANK_LINE.test(line.trim()) && ++hits >= 5) return true;
  }
  return false;
}
