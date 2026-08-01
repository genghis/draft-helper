import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createBoard is the one db call dynalite cannot run — it uses
 * TransactWriteItems. Rather than stand up a second DynamoDB implementation
 * for a single function, this asserts the command it builds: the two (or
 * three) items, their keys, and that they go out atomically. That covers the
 * real risk here, which is item-shape drift silently diverging from what
 * getBoard and the seeded tests expect.
 */
const send = vi.fn().mockResolvedValue({});

vi.mock("../src/db/client.js", () => ({
  TABLE_NAME: "TestTable",
  ddb: { send: (...args: unknown[]) => send(...args) },
  scanAll: vi.fn().mockResolvedValue([]),
}));

const { createBoard } = await import("../src/db/boards.js");

const input = {
  name: "Sheet",
  position: "OVERALL" as const,
  scoring: "PPR" as const,
  bands: [{ y0: 0, y1: 100, label: "Tier 1" }],
  placements: { p1: { x: 500, y: 10 } },
};

function sentTransactItems() {
  expect(send).toHaveBeenCalledTimes(1);
  const command = send.mock.calls[0]![0] as { input: { TransactItems: unknown[] } };
  return command.input.TransactItems as {
    Put: { TableName: string; Item: Record<string, unknown> };
  }[];
}

beforeEach(() => send.mockClear());

describe("createBoard", () => {
  it("writes meta and layout atomically in one transaction", async () => {
    const meta = await createBoard("user-1", input);
    const items = sentTransactItems();

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.Put.Item.sk)).toEqual(["META", "LAYOUT"]);
    expect(new Set(items.map((i) => i.Put.Item.pk))).toEqual(new Set([`BOARD#${meta.id}`]));
    expect(items.every((i) => i.Put.TableName === "TestTable")).toBe(true);
  });

  it("seeds the meta row the version guard depends on", async () => {
    // updateBoardMeta distinguishes "predates versioning" (no attribute) from
    // version 0, so a new board must start at 1 or its first edit 409s.
    await createBoard("user-1", input);
    const metaItem = sentTransactItems()[0]!.Put.Item;
    expect(metaItem.version).toBe(1);
    expect(metaItem.ownerId).toBe("user-1");
    expect(metaItem.bands).toEqual(input.bands);
    expect(metaItem.name).toBe("Sheet");
  });

  it("starts the layout at version 1 for the optimistic layout saver", async () => {
    await createBoard("user-1", input);
    const layoutItem = sentTransactItems()[1]!.Put.Item;
    expect(layoutItem.version).toBe(1);
    expect(layoutItem.placements).toEqual(input.placements);
  });

  it("adds an agreement row only when consensus supplied one", async () => {
    await createBoard("user-1", {
      ...input,
      agreement: { p1: { coverage: 2, spread: 1.5 } },
    });
    const items = sentTransactItems();
    expect(items).toHaveLength(3);
    expect(items[2]!.Put.Item.sk).toBe("AGREEMENT");
  });
});
