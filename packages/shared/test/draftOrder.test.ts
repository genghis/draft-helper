import { describe, expect, it } from "vitest";
import {
  buildBoard,
  deriveOrder,
  emptyOrder,
  isValidDraftOrder,
  namedSeatsBeyond,
  orderWarnings,
  nextOverallForSlot,
  overallForSlot,
  picksMade,
  resizeOrder,
  roundAndPick,
  sequencePicks,
  slotForOverall,
  turnStatus,
  unlinkSeat,
} from "../src/draftOrder.js";
import type { Pick } from "../src/types.js";

const TEAMS = 4;

function espnPick(playerId: string, overall: number, espnTeamId: number, mine = false): Pick {
  return { playerId, source: "espn", mine, pickedAt: "2026-08-30T00:00:00Z", overall, espnTeamId };
}

function manualPick(playerId: string, pickedAt: string): Pick {
  return { playerId, source: "manual", mine: false, pickedAt };
}

describe("slotForOverall", () => {
  it("snakes: odd rounds forward, even rounds back", () => {
    const slots = Array.from({ length: 12 }, (_, i) => slotForOverall(i + 1, TEAMS));
    expect(slots).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
  });

  it("gives a slot back-to-back picks at the turn", () => {
    expect(slotForOverall(4, TEAMS)).toBe(slotForOverall(5, TEAMS));
  });
});

describe("roundAndPick / overallForSlot", () => {
  it("labels picks as round.pick", () => {
    expect(roundAndPick(1, TEAMS)).toEqual({ round: 1, pick: 1 });
    expect(roundAndPick(5, TEAMS)).toEqual({ round: 2, pick: 1 });
    expect(roundAndPick(12, TEAMS)).toEqual({ round: 3, pick: 4 });
  });

  it("round-trips against slotForOverall for every slot and round", () => {
    for (let round = 1; round <= 5; round++) {
      for (let slot = 0; slot < TEAMS; slot++) {
        const overall = overallForSlot(slot, round, TEAMS);
        expect(slotForOverall(overall, TEAMS)).toBe(slot);
        expect(roundAndPick(overall, TEAMS).round).toBe(round);
      }
    }
  });
});

describe("nextOverallForSlot", () => {
  it("returns the current pick when the slot is on the clock", () => {
    // 2 picks in -> pick 3 is next, which belongs to slot 2.
    expect(nextOverallForSlot(2, TEAMS, 2)).toBe(3);
  });

  it("looks into the next round once this round's pick has passed", () => {
    // Slot 0 picked at 1; with 2 in, its next is the round-2 turn at overall 8.
    expect(nextOverallForSlot(0, TEAMS, 2)).toBe(8);
  });

  it("handles an empty board", () => {
    expect(nextOverallForSlot(3, TEAMS, 0)).toBe(4);
  });
});

describe("sequencePicks", () => {
  it("orders numbered picks first, then manual ones by mark time", () => {
    const picks = [
      manualPick("m2", "2026-08-30T00:00:02Z"),
      espnPick("e2", 2, 20),
      manualPick("m1", "2026-08-30T00:00:01Z"),
      espnPick("e1", 1, 10),
    ];
    expect(sequencePicks(picks).map((p) => p.playerId)).toEqual(["e1", "e2", "m1", "m2"]);
  });
});

describe("deriveOrder", () => {
  it("fills seats and mySlot from round 1's live picks", () => {
    const picks = [
      espnPick("a", 1, 7),
      espnPick("b", 2, 3),
      espnPick("c", 3, 11, true),
      espnPick("d", 4, 5),
    ];
    const order = deriveOrder(picks, emptyOrder(TEAMS));
    expect(order.teams.map((t) => t.espnTeamId)).toEqual([7, 3, 11, 5]);
    expect(order.teams[0]!.name).toBe("Team 7");
    expect(order.mySlot).toBe(2);
  });

  it("ignores picks past round 1", () => {
    const picks = [espnPick("a", 1, 7), espnPick("e", 5, 5)];
    const order = deriveOrder(picks, emptyOrder(TEAMS));
    expect(order.teams[0]!.espnTeamId).toBe(7);
    expect(order.teams.slice(1).every((t) => t.espnTeamId === undefined)).toBe(true);
  });

  it("never overwrites a name or slot the user set by hand", () => {
    const base = { ...emptyOrder(TEAMS), mySlot: 0 };
    base.teams[0] = { name: "Dave's Team" };
    const derived = deriveOrder([espnPick("a", 1, 7, true)], base);
    expect(derived.teams[0]).toEqual({ name: "Dave's Team", espnTeamId: 7 });
    expect(derived.mySlot).toBe(0);
  });

  it("returns the same object when there is nothing to learn", () => {
    const order = emptyOrder(TEAMS);
    expect(deriveOrder([manualPick("m", "2026-08-30T00:00:01Z")], order)).toBe(order);
  });
});

describe("buildBoard", () => {
  it("uses the real ESPN team even when it contradicts the snake position", () => {
    // Seat 0 is team 7, but pick 2 came from team 7 too (an out-of-order or
    // traded pick): the live id must win over the snake guess.
    const order = deriveOrder([espnPick("a", 1, 7)], emptyOrder(TEAMS));
    const rows = buildBoard([espnPick("a", 1, 7), espnPick("b", 2, 7)], order);
    expect(rows[1]!.slot).toBe(0);
    expect(rows[1]!.attributed).toBe(true);
  });

  it("falls back to the snake position for manually marked picks", () => {
    const order = emptyOrder(TEAMS);
    const rows = buildBoard(
      [manualPick("m1", "2026-08-30T00:00:01Z"), manualPick("m2", "2026-08-30T00:00:02Z")],
      order
    );
    expect(rows.map((r) => r.overall)).toEqual([1, 2]);
    expect(rows.map((r) => r.slot)).toEqual([0, 1]);
    expect(rows.every((r) => !r.attributed)).toBe(true);
  });

  it("never fabricates an overall that collides with a real one", () => {
    // ESPN numbered 1 and 5 (3 and 4 were dropped/unmapped); two manual marks
    // must land above 5, not at index positions 3 and 4.
    const rows = buildBoard(
      [
        espnPick("e1", 1, 10),
        espnPick("e5", 5, 50),
        manualPick("m1", "2026-08-30T00:00:01Z"),
        manualPick("m2", "2026-08-30T00:00:02Z"),
      ],
      emptyOrder(TEAMS)
    );
    expect(rows.map((r) => r.overall)).toEqual([1, 5, 6, 7]);
    expect(new Set(rows.map((r) => r.overall)).size).toBe(rows.length);
  });

  it("labels rows with round and pick", () => {
    const rows = buildBoard([espnPick("a", 5, 5)], emptyOrder(TEAMS));
    expect(rows[0]).toMatchObject({ round: 2, pick: 1, overall: 5 });
  });
});

describe("turnStatus", () => {
  it("is null until the user's slot is known", () => {
    expect(turnStatus(3, emptyOrder(TEAMS))).toBeNull();
  });

  it("reports being on the clock as zero picks away", () => {
    const order = { ...emptyOrder(TEAMS), mySlot: 2 };
    expect(turnStatus(2, order)).toMatchObject({ nextOverall: 3, picksAway: 0, round: 1 });
  });

  it("counts picks until the next turn", () => {
    const order = { ...emptyOrder(TEAMS), mySlot: 0 };
    // 1 pick in; slot 0 already went, so its next is overall 8 — 6 picks away.
    expect(turnStatus(1, order)).toMatchObject({ nextOverall: 8, picksAway: 6 });
  });
});

describe("resizeOrder", () => {
  it("keeps existing seats and clamps to the allowed range", () => {
    const order = deriveOrder([espnPick("a", 1, 7)], emptyOrder(TEAMS));
    const bigger = resizeOrder(order, 6);
    expect(bigger.teams).toHaveLength(6);
    expect(bigger.teams[0]!.espnTeamId).toBe(7);
    expect(resizeOrder(order, 99).teamCount).toBe(20);
    expect(resizeOrder(order, 1).teamCount).toBe(2);
  });

  it("leaves the order alone for a non-numeric count (a half-typed input)", () => {
    const order = emptyOrder(TEAMS);
    expect(resizeOrder(order, NaN)).toBe(order);
    expect(resizeOrder(order, 12.7).teamCount).toBe(12);
  });

  it("drops mySlot when it falls outside the smaller list", () => {
    const order = { ...emptyOrder(TEAMS), mySlot: 3 };
    expect(resizeOrder(order, 2).mySlot).toBeNull();
  });
});

describe("isValidDraftOrder", () => {
  const ok = { ...emptyOrder(TEAMS), mySlot: 1 };

  it("accepts what emptyOrder and deriveOrder produce", () => {
    expect(isValidDraftOrder(emptyOrder(TEAMS))).toBe(true);
    expect(isValidDraftOrder(ok)).toBe(true);
    expect(isValidDraftOrder(deriveOrder([espnPick("a", 1, 7, true)], emptyOrder(TEAMS)))).toBe(
      true
    );
  });

  it("rejects a seat list that doesn't match teamCount", () => {
    expect(isValidDraftOrder({ ...ok, teams: ok.teams.slice(1) })).toBe(false);
  });

  it("rejects out-of-range team counts and mySlot", () => {
    expect(isValidDraftOrder({ ...emptyOrder(2), teamCount: 1 })).toBe(false);
    expect(isValidDraftOrder({ ...ok, teamCount: 1.5 })).toBe(false);
    expect(isValidDraftOrder({ ...ok, mySlot: TEAMS })).toBe(false);
    expect(isValidDraftOrder({ ...ok, mySlot: -1 })).toBe(false);
    expect(isValidDraftOrder({ ...ok, mySlot: 1.5 })).toBe(false);
    expect(isValidDraftOrder({ ...ok, mySlot: undefined })).toBe(false);
  });

  it("rejects bad seat shapes", () => {
    const withSeat = (seat: unknown) => ({ ...ok, teams: [seat, ...ok.teams.slice(1)] });
    expect(isValidDraftOrder(withSeat({ name: 42 }))).toBe(false);
    expect(isValidDraftOrder(withSeat({ name: "x".repeat(41) }))).toBe(false);
    expect(isValidDraftOrder(withSeat({ name: "a", espnTeamId: "7" }))).toBe(false);
    expect(isValidDraftOrder(withSeat(null))).toBe(false);
  });

  it("rejects unknown keys on a seat, which storage would otherwise carry", () => {
    const smuggled = { ...ok, teams: [{ name: "a", pk: "USER#x" }, ...ok.teams.slice(1)] };
    expect(isValidDraftOrder(smuggled)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidDraftOrder(null)).toBe(false);
    expect(isValidDraftOrder("order")).toBe(false);
    expect(isValidDraftOrder([])).toBe(false);
  });
});

describe("picksMade", () => {
  it("uses the highest overall when picks were dropped", () => {
    // Only 2 rows stored but ESPN numbered one of them 9: the draft is 9 deep,
    // and counting rows would slide every countdown by 7.
    expect(picksMade([espnPick("a", 1, 10), espnPick("b", 9, 20)])).toBe(9);
  });

  it("falls back to the row count when nothing is numbered", () => {
    expect(
      picksMade([
        manualPick("m1", "2026-08-30T00:00:01Z"),
        manualPick("m2", "2026-08-30T00:00:02Z"),
      ])
    ).toBe(2);
  });

  it("keeps the count when manual marks outnumber the ESPN range", () => {
    expect(
      picksMade([
        espnPick("a", 1, 10),
        manualPick("m1", "2026-08-30T00:00:01Z"),
        manualPick("m2", "2026-08-30T00:00:02Z"),
      ])
    ).toBe(3);
  });

  it("is empty-safe", () => {
    expect(picksMade([])).toBe(0);
  });
});

describe("orderWarnings", () => {
  const seated = deriveOrder(
    [espnPick("a", 1, 10), espnPick("b", 2, 20), espnPick("c", 3, 30), espnPick("d", 4, 40)],
    emptyOrder(TEAMS)
  );

  it("is quiet when the order matches the picks", () => {
    // Round 2 snakes back: overall 5 -> slot 3 (team 40), 6 -> slot 2 (team 30).
    const picks = [espnPick("e", 5, 40), espnPick("f", 6, 30)];
    expect(orderWarnings(picks, seated)).toEqual([]);
  });

  it("flags more drafting teams than the league size", () => {
    const picks = [espnPick("a", 1, 10), espnPick("b", 2, 20), espnPick("c", 3, 30)];
    const warnings = orderWarnings(picks, emptyOrder(2));
    expect(warnings.map((w) => w.kind)).toContain("too-many-teams");
  });

  it("flags a wrong team count via post-round-1 snake mismatches", () => {
    const picks = [espnPick("e", 5, 10), espnPick("f", 6, 20), espnPick("g", 7, 30)];
    const warnings = orderWarnings(picks, seated);
    expect(warnings.map((w) => w.kind)).toContain("order-mismatch");
  });

  it("tolerates a single traded pick without crying wolf", () => {
    // 1 of 3 out of position — a trade, not a broken order.
    const picks = [espnPick("e", 5, 40), espnPick("f", 6, 30), espnPick("g", 7, 10)];
    expect(orderWarnings(picks, seated).map((w) => w.kind)).not.toContain("order-mismatch");
  });

  it("flags two seats bound to the same ESPN team", () => {
    const dup = {
      ...seated,
      teams: seated.teams.map((t, i) => (i === 1 ? { ...t, espnTeamId: 10 } : t)),
    };
    expect(orderWarnings([], dup).map((w) => w.kind)).toContain("duplicate-seat");
  });

  it("says nothing before any picks arrive", () => {
    expect(orderWarnings([], emptyOrder(TEAMS))).toEqual([]);
  });
});

describe("buildBoard with a duplicated seat link", () => {
  it("falls back to the snake rather than guessing a seat", () => {
    const base = deriveOrder([espnPick("a", 1, 10), espnPick("b", 2, 20)], emptyOrder(TEAMS));
    const dup = {
      ...base,
      teams: base.teams.map((t, i) => (i === 1 ? { ...t, espnTeamId: 10 } : t)),
    };
    const rows = buildBoard([espnPick("a", 1, 10)], dup);
    expect(rows[0]!.attributed).toBe(false);
    expect(rows[0]!.slot).toBe(slotForOverall(1, TEAMS));
  });
});

describe("unlinkSeat", () => {
  it("clears the ESPN link but keeps the name, so deriveOrder can refill it", () => {
    const order = deriveOrder([espnPick("a", 1, 7)], emptyOrder(TEAMS));
    const unlinked = unlinkSeat(order, 0);
    expect(unlinked.teams[0]).toEqual({ name: "Team 7" });
    expect(deriveOrder([espnPick("a", 1, 9)], unlinked).teams[0]!.espnTeamId).toBe(9);
  });

  it("is a no-op on an unlinked or unknown seat", () => {
    const order = emptyOrder(TEAMS);
    expect(unlinkSeat(order, 0)).toBe(order);
    expect(unlinkSeat(order, 99)).toBe(order);
  });
});

describe("namedSeatsBeyond", () => {
  it("reports the names a shrink would drop", () => {
    const order = emptyOrder(TEAMS);
    order.teams[2] = { name: "Dave" };
    order.teams[3] = { name: "" };
    expect(namedSeatsBeyond(order, 2)).toEqual(["Dave"]);
    expect(namedSeatsBeyond(order, TEAMS)).toEqual([]);
  });
});

describe("unknown ESPN team id (0) is never treated as a team", () => {
  // The extension's DOM-rescan catch-up reports teamId 0 for "saw the pick,
  // couldn't tell who made it". Binding seats to it would put every catch-up
  // pick on one team.
  const unknown = (playerId: string, overall: number): Pick => ({
    playerId,
    source: "espn",
    mine: false,
    pickedAt: "2026-08-30T00:00:00Z",
    overall,
    espnTeamId: 0,
  });

  it("never binds a seat to team 0", () => {
    const before = emptyOrder(TEAMS);
    const after = deriveOrder([unknown("a", 1), unknown("b", 2)], before);
    // Nothing learned, so deriveOrder returns its input by identity — which is
    // also what keeps the auto-derive effect from saving on every poll.
    expect(after).toBe(before);
    expect(after.teams.every((t) => t.espnTeamId === undefined)).toBe(true);
  });

  it("falls back to the snake instead of attributing to team 0", () => {
    const seeded = deriveOrder([espnPick("x", 1, 7)], emptyOrder(TEAMS));
    const withZero = {
      ...seeded,
      teams: seeded.teams.map((t, i) => (i === 1 ? { ...t, espnTeamId: 0 } : t)),
    };
    const rows = buildBoard([unknown("a", 2)], withZero);
    expect(rows[0]!.attributed).toBe(false);
    expect(rows[0]!.slot).toBe(slotForOverall(2, TEAMS));
  });

  it("does not count team 0 toward the too-many-teams warning", () => {
    const picks = [espnPick("a", 1, 7), unknown("b", 2), unknown("c", 3)];
    expect(orderWarnings(picks, emptyOrder(2)).map((w) => w.kind)).not.toContain(
      "too-many-teams"
    );
  });

  it("does not report two seats stuck at 0 as duplicates", () => {
    const order = emptyOrder(TEAMS);
    order.teams[0] = { name: "a", espnTeamId: 0 };
    order.teams[1] = { name: "b", espnTeamId: 0 };
    expect(orderWarnings([], order).map((w) => w.kind)).not.toContain("duplicate-seat");
  });
});
