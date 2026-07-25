import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDraftFrame } from "../src/parse/espnDraft.js";

const captured = readFileSync(
  new URL("./fixtures/espn-draft/messages.txt", import.meta.url),
  "utf8"
);

describe("parseDraftFrame", () => {
  it("parses SELECTED into pick events", () => {
    expect(parseDraftFrame("SELECTED 2 4685278 16\n")).toEqual([
      { type: "pick", teamId: 2, espnPlayerId: 4685278, lineupSlotId: 16 },
    ]);
  });

  it("parses negative D/ST ids", () => {
    expect(parseDraftFrame("SELECTED 1 -16007 8\n")).toEqual([
      { type: "pick", teamId: 1, espnPlayerId: -16007, lineupSlotId: 8 },
    ]);
  });

  it("parses SELECTING and AUTODRAFT", () => {
    expect(parseDraftFrame("SELECTING 3 30000")).toEqual([
      { type: "selecting", teamId: 3, clockMs: 30000 },
    ]);
    expect(parseDraftFrame("AUTODRAFT 1 false")).toEqual([
      { type: "autodraft", teamId: 1, enabled: false },
    ]);
  });

  it("ignores unknown and malformed commands without throwing", () => {
    expect(parseDraftFrame("INIT AAAA====garbage")).toEqual([]);
    expect(parseDraftFrame("PONG")).toEqual([]);
    expect(parseDraftFrame("TOKEN 1:123:1:{X}:99")).toEqual([]);
    expect(parseDraftFrame("SELECTED notanumber x")).toEqual([]);
    expect(parseDraftFrame("")).toEqual([]);
  });

  it("handles the full captured session without errors", () => {
    const events = captured.split("\n").flatMap((line) => parseDraftFrame(line));
    const picks = events.filter((e) => e.type === "pick");
    // The capture contains 9 SELECTED lines (see fixtures/espn-draft/messages.txt).
    expect(picks).toHaveLength(9);
    expect(picks.every((p) => p.type === "pick" && Number.isFinite(p.espnPlayerId))).toBe(true);
  });
});

describe("parseDraftFrame slot hardening", () => {
  it("defaults a non-numeric lineupSlotId to 0", () => {
    expect(parseDraftFrame("SELECTED 2 4685278 xx")).toEqual([
      { type: "pick", teamId: 2, espnPlayerId: 4685278, lineupSlotId: 0 },
    ]);
  });
});
