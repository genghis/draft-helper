import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { startDdb, type TestDdb } from "./support/ddb.js";

/**
 * The db layer is imported dynamically AFTER the endpoint env vars are set,
 * because client.ts builds its DynamoDB client at module scope.
 */
let ddb: TestDdb;
let boards: typeof import("../src/db/boards.js");

beforeAll(async () => {
  ddb = await startDdb();
  process.env.TABLE_NAME = ddb.tableName;
  process.env.AWS_ENDPOINT_URL_DYNAMODB = ddb.endpoint;
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  boards = await import("../src/db/boards.js");
});

afterAll(async () => {
  await ddb.stop();
});

function docClient() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: ddb.endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    })
  );
}

/** Makes a board look like one written before `version` existed. */
async function stripVersion(boardId: string) {
  const doc = docClient();
  await doc.send(
    new UpdateCommand({
      TableName: ddb.tableName,
      Key: { pk: `BOARD#${boardId}`, sk: "META" },
      UpdateExpression: "REMOVE version",
    })
  );
  doc.destroy();
}

const bands = [
  { y0: 0, y1: 100, label: "Tier 1" },
  { y0: 100, y1: 200, label: "Tier 2" },
];

let seq = 0;

/**
 * Seeds the META row directly rather than via createBoard, which uses
 * TransactWriteItems — an operation dynalite does not implement. The item
 * shape mirrors createBoard's; if that shape changes these tests must follow.
 * createBoard's transaction is therefore NOT covered here.
 */
async function newBoard(name = "Sheet"): Promise<{ id: string }> {
  const id = `board-${++seq}`;
  const now = new Date().toISOString();
  const doc = docClient();
  await doc.send(
    new PutCommand({
      TableName: ddb.tableName,
      Item: {
        pk: `BOARD#${id}`,
        sk: "META",
        ownerId: "user-1",
        name,
        position: "OVERALL",
        scoring: "PPR",
        bands,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    })
  );
  // getBoard requires both rows, so the layout has to exist too.
  await doc.send(
    new PutCommand({
      TableName: ddb.tableName,
      Item: {
        pk: `BOARD#${id}`,
        sk: "LAYOUT",
        placements: { p1: { x: 0, y: 10 } },
        version: 1,
      },
    })
  );
  doc.destroy();
  return { id };
}

describe("updateBoardMeta version guard", () => {
  it("bumps the version on each accepted write", async () => {
    const board = await newBoard();
    const first = await boards.updateBoardMeta(board.id, { name: "Renamed" }, 1);
    expect(first?.version).toBe(2);

    const second = await boards.updateBoardMeta(board.id, { bands }, 2);
    expect(second?.version).toBe(3);
  });

  it("refuses a stale writer — the two-tab tier clobber", async () => {
    const board = await newBoard();
    // Tab A saves.
    expect(await boards.updateBoardMeta(board.id, { bands }, 1)).not.toBeNull();
    // Tab B still holds version 1 and must be rejected, not silently win.
    expect(await boards.updateBoardMeta(board.id, { bands }, 1)).toBeNull();
  });

  it("accepts a board that predates versioning, treating it as version 0", async () => {
    // A row written before `version` existed has no such attribute. The guard
    // must express that as attribute_not_exists, NOT if_not_exists() — the
    // latter is an update-expression function that DynamoDB rejects outright
    // in a ConditionExpression, which would fail every tier edit on an old
    // cheat sheet.
    const board = await newBoard();
    await stripVersion(board.id);
    const raw = await boards.getBoard(board.id);
    expect(raw?.meta.version).toBe(0);

    const updated = await boards.updateBoardMeta(board.id, { bands }, 0);
    expect(updated).not.toBeNull();
    expect(updated?.version).toBe(1);
  });

  it("refuses version 0 once the board has been versioned", async () => {
    const board = await newBoard();
    expect(await boards.updateBoardMeta(board.id, { bands }, 0)).toBeNull();
  });

  it("keeps last-write-wins when no version is supplied", async () => {
    const board = await newBoard();
    expect(await boards.updateBoardMeta(board.id, { name: "A" })).not.toBeNull();
    expect(await boards.updateBoardMeta(board.id, { name: "B" })).not.toBeNull();
  });

  it("returns null for a board that does not exist", async () => {
    expect(await boards.updateBoardMeta("missing", { name: "X" }, 1)).toBeNull();
  });
});
