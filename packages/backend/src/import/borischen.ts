import type { BoardPosition, ScoringFormat } from "@drafthelper/shared";

/**
 * borischen.co publishes to this bucket; file naming drifts season to season
 * (preseason "draft" files vs the weekly family), so patterns are env-tunable
 * without a deploy: BORIS_BASE and BORIS_FILES (comma-separated templates
 * with {pos} and {fmt} slots, tried in order).
 */
const DEFAULT_BASE = "https://s3-us-west-1.amazonaws.com/fftiers/out";
const DEFAULT_FILES = "weekly-{pos}{fmt}.csv,text_{pos}{fmt}.txt";

/** Positions whose rankings differ by scoring format. */
const FORMAT_SENSITIVE = new Set(["RB", "WR", "TE", "FLX", "OVERALL"]);

/**
 * fftiers names the full-draft list "ALL"; our scope for the same thing is
 * OVERALL.
 */
const FILE_POSITION: Partial<Record<string, string>> = { OVERALL: "ALL" };

const FORMAT_SUFFIX: Record<ScoringFormat, string> = {
  STD: "",
  HALF: "-HALF",
  PPR: "-PPR",
};

/**
 * The overall list suffixes half-PPR differently from every per-position file:
 * weekly-RB-HALF.csv but weekly-ALL-HALF-PPR.csv. Naming drifts season to
 * season, so this is an ordered list of suffixes to try, not a single value.
 */
const HALF_SUFFIXES: Partial<Record<string, string[]>> = {
  OVERALL: ["-HALF-PPR", "-HALF"],
};

/**
 * Every URL worth trying for a scope and scoring, in priority order. Pure, so
 * the naming quirks are pinned by tests instead of rediscovered against the
 * live bucket.
 */
export function borisChenUrls(
  position: BoardPosition,
  scoring: ScoringFormat,
  base = process.env.BORIS_BASE ?? DEFAULT_BASE,
  templates = (process.env.BORIS_FILES ?? DEFAULT_FILES).split(",")
): string[] {
  const formats = !FORMAT_SENSITIVE.has(position)
    ? [""]
    : scoring === "HALF"
      ? (HALF_SUFFIXES[position] ?? [FORMAT_SUFFIX.HALF])
      : [FORMAT_SUFFIX[scoring]];

  const urls: string[] = [];
  for (const template of templates) {
    for (const fmt of formats) {
      const file = template
        .trim()
        .replace("{pos}", FILE_POSITION[position] ?? position)
        .replace("{fmt}", fmt);
      urls.push(`${base}/${file}`);
    }
  }
  return urls;
}

export async function fetchBorisChen(
  position: BoardPosition,
  scoring: ScoringFormat
): Promise<{ content: string; url: string } | null> {
  for (const url of borisChenUrls(position, scoring)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { content: await res.text(), url };
  }
  return null;
}
