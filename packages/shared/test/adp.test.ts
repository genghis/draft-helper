import { describe, expect, it } from "vitest";
import { adpDivergence, adpValue, boardAdpRanks, primaryAdp,
  formatAdp,
} from "../src/adp.js";

describe("primaryAdp", () => {
  it("prefers ESPN, falls back to FFC, else undefined", () => {
    expect(primaryAdp({ espn: 10, ffc: 12 })).toBe(10);
    expect(primaryAdp({ ffc: 12 })).toBe(12);
    expect(primaryAdp({})).toBeUndefined();
    expect(primaryAdp(undefined)).toBeUndefined();
  });
});

describe("boardAdpRanks", () => {
  it("ranks the board's players by ADP, ties broken by id", () => {
    const ranks = boardAdpRanks(new Map([["a", 5], ["b", 2], ["c", 5]]));
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("a")).toBe(2); // tie 5 -> "a" before "c"
    expect(ranks.get("c")).toBe(3);
  });
});

describe("adpDivergence", () => {
  it("is the absolute gap when both present, else null", () => {
    expect(adpDivergence({ espn: 20, ffc: 34 })).toBe(14);
    expect(adpDivergence({ espn: 20 })).toBeNull();
    expect(adpDivergence({})).toBeNull();
  });
});

describe("adpValue", () => {
  it("is positive for a faller (market later than your rank)", () => {
    expect(adpValue(3, 9)).toBe(6); // you rank 3rd, market 9th -> +6 value
    expect(adpValue(9, 3)).toBe(-6); // reach
  });
});

describe("formatAdp", () => {
  it("keeps a decimal at the top of the board, where a tenth is real", () => {
    // Gibbs 1.6 and Bijan 2.0 both rendered "2" and looked tied.
    expect(formatAdp(1.6)).toBe("1.6");
    expect(formatAdp(2)).toBe("2.0");
    expect(formatAdp(9.94)).toBe("9.9");
  });

  it("rounds once fractions stop deciding anything", () => {
    expect(formatAdp(10)).toBe("10");
    expect(formatAdp(10.4)).toBe("10");
    expect(formatAdp(183.7)).toBe("184");
  });

  it("shows a dash rather than a number it does not have", () => {
    expect(formatAdp(undefined)).toBe("—");
    expect(formatAdp(NaN)).toBe("—");
  });
});
