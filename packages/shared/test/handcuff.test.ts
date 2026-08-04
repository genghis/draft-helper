import { describe, expect, it } from "vitest";
import { computeHandcuffIds, reconcileHandcuffTag } from "../src/handcuff.js";
import type { Player, Tag } from "../src/types.js";

const rb = (id: string, team: string | null): Player => ({
  id,
  name: id,
  position: "RB",
  team,
  espnId: null,
});

const wr = (id: string, team: string | null): Player => ({
  id,
  name: id,
  position: "WR",
  team,
  espnId: null,
});

describe("computeHandcuffIds", () => {
  it("tags the single eligible backup", () => {
    const players = [rb("lead", "SF"), rb("backup", "SF"), wr("other", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["backup", 30],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead"]),
    });
    expect(ids).toEqual(["backup"]);
  });

  it("tags two backups within the rank gap", () => {
    const players = [rb("lead", "SF"), rb("b1", "SF"), rb("b2", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["b1", 40],
      ["b2", 55], // gap of 15, within HANDCUFF_RANK_GAP (20)
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead"]),
    });
    expect(new Set(ids)).toEqual(new Set(["b1", "b2"]));
  });

  it("only tags the top backup when the 2nd is outside the gap", () => {
    const players = [rb("lead", "SF"), rb("b1", "SF"), rb("b2", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["b1", 40],
      ["b2", 70], // gap of 30, outside the gap
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead"]),
    });
    expect(ids).toEqual(["b1"]);
  });

  it("hard-caps at 2 even with three close backups", () => {
    const players = [rb("lead", "SF"), rb("b1", "SF"), rb("b2", "SF"), rb("b3", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["b1", 40],
      ["b2", 45],
      ["b3", 50],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead"]),
    });
    expect(ids.length).toBe(2);
    expect(new Set(ids)).toEqual(new Set(["b1", "b2"]));
  });

  it("returns nothing when there are no eligible RBs or the lead has no team", () => {
    const players = [rb("lead", null), wr("wide", "SF")];
    const rankById = new Map([["lead", 1]]);
    expect(
      computeHandcuffIds({ myRbIds: ["lead"], players, rankById, draftedIds: new Set(["lead"]) })
    ).toEqual([]);

    const players2 = [rb("lead2", "SF")];
    expect(
      computeHandcuffIds({
        myRbIds: ["lead2"],
        players: players2,
        rankById: new Map([["lead2", 1]]),
        draftedIds: new Set(["lead2"]),
      })
    ).toEqual([]);
  });

  it("excludes a teammate already drafted by anyone, even if best-ranked", () => {
    const players = [rb("lead", "SF"), rb("gone", "SF"), rb("next", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["gone", 20],
      ["next", 45],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead", "gone"]),
    });
    expect(ids).toEqual(["next"]);
  });

  it("drops unranked teammates from comparison", () => {
    const players = [rb("lead", "SF"), rb("unranked", "SF"), rb("ranked", "SF")];
    const rankById = new Map([
      ["lead", 1],
      ["ranked", 50],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead"],
      players,
      rankById,
      draftedIds: new Set(["lead"]),
    });
    expect(ids).toEqual(["ranked"]);
  });

  it("unions and dedupes across multiple drafted RBs on different teams", () => {
    const players = [
      rb("leadA", "SF"),
      rb("backupA", "SF"),
      rb("leadB", "DAL"),
      rb("backupB", "DAL"),
    ];
    const rankById = new Map([
      ["leadA", 1],
      ["backupA", 40],
      ["leadB", 2],
      ["backupB", 41],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["leadA", "leadB"],
      players,
      rankById,
      draftedIds: new Set(["leadA", "leadB"]),
    });
    expect(new Set(ids)).toEqual(new Set(["backupA", "backupB"]));
  });

  it("doesn't duplicate a backup that qualifies for two of your leads", () => {
    // Two leads on the same team (unusual, but shouldn't double-count the backup).
    const players = [rb("lead1", "SF"), rb("lead2", "SF"), rb("backup", "SF")];
    const rankById = new Map([
      ["lead1", 1],
      ["lead2", 2],
      ["backup", 40],
    ]);
    const ids = computeHandcuffIds({
      myRbIds: ["lead1", "lead2"],
      players,
      rankById,
      draftedIds: new Set(["lead1", "lead2"]),
    });
    expect(ids).toEqual(["backup"]);
  });
});

const tag = (overrides: Partial<Tag>): Tag => ({
  meta: {
    id: "t1",
    ownerId: "u1",
    label: "Handcuff",
    color: "amber",
    playerCount: 0,
    version: 1,
    createdAt: "",
    updatedAt: "",
    autoManaged: "handcuff",
  },
  playerIds: [],
  ...overrides,
});

describe("reconcileHandcuffTag", () => {
  it("creates fresh membership when there's no existing tag", () => {
    const result = reconcileHandcuffTag(null, ["a"]);
    expect(result.playerIds).toEqual(["a"]);
    expect(result.autoAddedIds).toEqual(["a"]);
    expect(result.added).toEqual(["a"]);
    expect(result.removed).toEqual([]);
  });

  it("retracts an auto-added player once he no longer qualifies (e.g. undo)", () => {
    const existing = tag({ playerIds: ["a"], autoAddedIds: ["a"] });
    const result = reconcileHandcuffTag(existing, []);
    expect(result.playerIds).toEqual([]);
    expect(result.autoAddedIds).toEqual([]);
    expect(result.removed).toEqual(["a"]);
  });

  it("respects a manual exclusion — never re-adds it", () => {
    const existing = tag({ playerIds: [], autoAddedIds: [], autoExcludedIds: ["a"] });
    const result = reconcileHandcuffTag(existing, ["a"]);
    expect(result.playerIds).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it("preserves a manually-added member through a recompute", () => {
    const existing = tag({ playerIds: ["manual"], autoAddedIds: [] });
    const result = reconcileHandcuffTag(existing, ["a"]);
    expect(new Set(result.playerIds)).toEqual(new Set(["manual", "a"]));
    expect(result.autoAddedIds).toEqual(["a"]);
  });

  it("handles a mixed pass: retract one auto, keep a manual, respect an exclusion", () => {
    const existing = tag({
      playerIds: ["stale", "manual"],
      autoAddedIds: ["stale"],
      autoExcludedIds: ["excluded"],
    });
    const result = reconcileHandcuffTag(existing, ["excluded", "fresh"]);
    expect(new Set(result.playerIds)).toEqual(new Set(["manual", "fresh"]));
    expect(result.autoAddedIds).toEqual(["fresh"]);
    expect(result.removed).toEqual(["stale"]);
    expect(result.added).toEqual(["fresh"]);
  });
});
