import { describe, expect, it } from "vitest";
import { borisChenUrls } from "../src/import/borischen.js";

const BASE = "https://example.test/out";
const TEMPLATES = ["weekly-{pos}{fmt}.csv", "text_{pos}{fmt}.txt"];
const files = (pos: Parameters<typeof borisChenUrls>[0], fmt: Parameters<typeof borisChenUrls>[1]) =>
  borisChenUrls(pos, fmt, BASE, TEMPLATES).map((u) => u.split("/").pop());

describe("borisChenUrls", () => {
  it("maps our OVERALL scope onto the ALL files fftiers publishes", () => {
    // Asking for weekly-OVERALL-*.csv returns 403; the list is named ALL.
    expect(files("OVERALL", "PPR")).toEqual(["weekly-ALL-PPR.csv", "text_ALL-PPR.txt"]);
    expect(files("OVERALL", "STD")).toEqual(["weekly-ALL.csv", "text_ALL.txt"]);
  });

  it("uses the overall list's own half-PPR suffix, and keeps the usual one as a fallback", () => {
    // Per-position files are -HALF, but the overall list is -HALF-PPR. Both are
    // tried because the naming has drifted between seasons before.
    expect(files("OVERALL", "HALF")).toEqual([
      "weekly-ALL-HALF-PPR.csv",
      "weekly-ALL-HALF.csv",
      "text_ALL-HALF-PPR.txt",
      "text_ALL-HALF.txt",
    ]);
  });

  it("keeps the plain -HALF suffix for per-position lists", () => {
    expect(files("RB", "HALF")).toEqual(["weekly-RB-HALF.csv", "text_RB-HALF.txt"]);
    expect(files("FLX", "HALF")).toEqual(["weekly-FLX-HALF.csv", "text_FLX-HALF.txt"]);
  });

  it("omits the scoring suffix where rankings do not depend on it", () => {
    // A QB scores the same in every format, so there is one file, not three.
    for (const scoring of ["STD", "HALF", "PPR"] as const) {
      expect(files("QB", scoring)).toEqual(["weekly-QB.csv", "text_QB.txt"]);
      expect(files("DST", scoring)).toEqual(["weekly-DST.csv", "text_DST.txt"]);
    }
  });

  it("puts the CSV ahead of the tier text, since only the CSV carries tiers per row", () => {
    expect(borisChenUrls("WR", "PPR", BASE, TEMPLATES)[0]).toContain("weekly-WR-PPR.csv");
  });
});
