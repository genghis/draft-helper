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
const FORMAT_SENSITIVE = new Set(["RB", "WR", "TE", "FLX"]);

const FORMAT_SUFFIX: Record<ScoringFormat, string> = {
  STD: "",
  HALF: "-HALF",
  PPR: "-PPR",
};

export async function fetchBorisChen(
  position: BoardPosition,
  scoring: ScoringFormat
): Promise<{ content: string; url: string } | null> {
  const base = process.env.BORIS_BASE ?? DEFAULT_BASE;
  const templates = (process.env.BORIS_FILES ?? DEFAULT_FILES).split(",");
  const fmt = FORMAT_SENSITIVE.has(position) ? FORMAT_SUFFIX[scoring] : "";

  for (const template of templates) {
    const file = template.trim().replace("{pos}", position).replace("{fmt}", fmt);
    const url = `${base}/${file}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { content: await res.text(), url };
  }
  return null;
}
