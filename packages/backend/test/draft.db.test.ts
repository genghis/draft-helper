import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { startDdb, type TestDdb } from "./support/ddb.js";

let ddb: TestDdb;
let draft: typeof import("../src/db/draft.js");

beforeAll(async () => {
  ddb = await startDdb("DraftHelperDraftTest");
  process.env.TABLE_NAME = ddb.tableName;
  process.env.AWS_ENDPOINT_URL_DYNAMODB = ddb.endpoint;
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  draft = await import("../src/db/draft.js");
});

afterAll(async () => {
  await ddb.stop();
});

/** Reads the raw row, including tombstones that listPicks hides. */
async function rawPick(userId: string, playerId: string) {
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: ddb.endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    })
  );
  const res = await doc.send(
    new GetCommand({
      TableName: ddb.tableName,
      Key: { pk: `DRAFT#${userId}`, sk: `PICK#${playerId}` },
    })
  );
  doc.destroy();
  return res.Item;
}

let userSeq = 0;
const newUser = () => `user-${++userSeq}`;

describe("putPick preserves ESPN attribution", () => {
  it("keeps overall and espnTeamId when you mark your own synced pick", async () => {
    // The whole point: deriveOrder learns your seat from the pick you mark as
    // yours. A whole-item Put here would drop both fields, putEspnPick could
    // never restore them (it requires source=espn), and the turn banner would
    // stay dark for the rest of the draft.
    const user = newUser();
    expect(await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 3, teamId: 7 }))
      .toBe(true);

    const marked = await draft.putPick(user, "p1", { mine: true, source: "manual" });
    expect(marked.overall).toBe(3);
    expect(marked.espnTeamId).toBe(7);

    const [stored] = await draft.listPicks(user);
    expect(stored).toMatchObject({ overall: 3, espnTeamId: 7, mine: true, source: "manual" });
  });

  it("creates the row when the player was never synced", async () => {
    const user = newUser();
    const marked = await draft.putPick(user, "p9", { mine: false, source: "manual" });
    expect(marked.overall).toBeUndefined();
    expect(marked.espnTeamId).toBeUndefined();
    expect(await draft.listPicks(user)).toHaveLength(1);
  });

  it("clears a tombstone and its timestamp on re-mark", async () => {
    const user = newUser();
    await draft.putPick(user, "p2", { mine: false, source: "manual" });
    await draft.deletePick(user, "p2");
    expect(await draft.listPicks(user)).toHaveLength(0);

    await draft.putPick(user, "p2", { mine: true, source: "manual" });
    const row = await rawPick(user, "p2");
    expect(row?.deleted).toBeUndefined();
    expect(row?.deletedAt).toBeUndefined();
    expect(await draft.listPicks(user)).toHaveLength(1);
  });
});

describe("putEspnPick conditional writes", () => {
  it("refuses to clobber a manual mark", async () => {
    const user = newUser();
    await draft.putPick(user, "p1", { mine: true, source: "manual" });
    expect(
      await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 4 })
    ).toBe(false);
    const [stored] = await draft.listPicks(user);
    expect(stored!.mine).toBe(true);
    expect(stored!.source).toBe("manual");
  });

  it("refuses to resurrect a tombstoned pick", async () => {
    const user = newUser();
    await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 4 });
    await draft.deletePick(user, "p1");
    expect(
      await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 4 })
    ).toBe(false);
    expect(await draft.listPicks(user)).toHaveLength(0);
  });

  it("will not downgrade mine=true on a re-push that can't tell whose pick it is", async () => {
    const user = newUser();
    await draft.putEspnPick(user, { playerId: "p1", mine: true, overall: 1, teamId: 4 });
    expect(
      await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 4 })
    ).toBe(false);
    const [stored] = await draft.listPicks(user);
    expect(stored!.mine).toBe(true);
  });

  it("is idempotent across cumulative re-pushes", async () => {
    const user = newUser();
    for (let i = 0; i < 3; i++) {
      expect(
        await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 4 })
      ).toBe(true);
    }
    expect(await draft.listPicks(user)).toHaveLength(1);
  });

  it("never stores the extension's unknown-team sentinel (0) as a team", async () => {
    // ESPN team ids are 1-based; the DOM-rescan catch-up path reports 0 for
    // "saw the pick, couldn't tell who made it". Storing it would bind a seat
    // to team 0 and collapse every catch-up pick onto it.
    const user = newUser();
    await draft.putEspnPick(user, { playerId: "p1", mine: false, overall: 1, teamId: 0 });
    const [stored] = await draft.listPicks(user);
    expect(stored!.espnTeamId).toBeUndefined();
    expect(stored!.overall).toBe(1);
  });
});

describe("putDraftOrder", () => {
  const order = {
    teamCount: 2,
    teams: [{ name: "A" }, { name: "B", espnTeamId: 5 }],
    mySlot: 1,
  };

  it("round-trips through storage", async () => {
    const user = newUser();
    await draft.putDraftOrder(user, order);
    expect(await draft.getDraftOrder(user)).toEqual(order);
  });

  it("writes only the draft-order item, whatever the caller smuggles in", async () => {
    // The P0: spreading the request body after pk/sk let a caller overwrite the
    // key and write any item in the single-table design -- including a user
    // profile with admin:true.
    const user = newUser();
    const hostile = {
      ...order,
      pk: `USER#${user}`,
      sk: "PROFILE",
      admin: true,
      ownerId: "someone-else",
    } as unknown as Parameters<typeof draft.putDraftOrder>[1];

    await draft.putDraftOrder(user, hostile);

    const stored = await draft.getDraftOrder(user);
    expect(stored).toEqual(order);

    const doc = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        endpoint: ddb.endpoint,
        region: "us-east-1",
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      })
    );
    const forged = await doc.send(
      new GetCommand({ TableName: ddb.tableName, Key: { pk: `USER#${user}`, sk: "PROFILE" } })
    );
    const written = await doc.send(
      new GetCommand({ TableName: ddb.tableName, Key: { pk: `DRAFT#${user}`, sk: "ORDER" } })
    );
    doc.destroy();

    expect(forged.Item).toBeUndefined();
    expect(written.Item?.admin).toBeUndefined();
    expect(written.Item?.ownerId).toBeUndefined();
  });

  it("returns undefined when no order was ever saved", async () => {
    expect(await draft.getDraftOrder(newUser())).toBeUndefined();
  });
});

describe("resetDraft", () => {
  it("hard-deletes picks including tombstones, and counts only live ones", async () => {
    const user = newUser();
    await draft.putPick(user, "p1", { mine: false, source: "manual" });
    await draft.putPick(user, "p2", { mine: false, source: "manual" });
    await draft.deletePick(user, "p2");

    expect(await draft.resetDraft(user)).toBe(1);
    expect(await draft.listPicks(user)).toHaveLength(0);
    expect(await rawPick(user, "p2")).toBeUndefined();
  });

  it("clears learned ESPN links but keeps seat names and mySlot", async () => {
    const user = newUser();
    await draft.putDraftOrder(user, {
      teamCount: 2,
      teams: [{ name: "Dave", espnTeamId: 3 }, { name: "Sam", espnTeamId: 9 }],
      mySlot: 0,
    });
    await draft.resetDraft(user);

    expect(await draft.getDraftOrder(user)).toEqual({
      teamCount: 2,
      teams: [{ name: "Dave" }, { name: "Sam" }],
      mySlot: 0,
    });
  });

  it("leaves an order with no learned links untouched", async () => {
    const user = newUser();
    const plain = { teamCount: 2, teams: [{ name: "A" }, { name: "B" }], mySlot: null };
    await draft.putDraftOrder(user, plain);
    await draft.resetDraft(user);
    expect(await draft.getDraftOrder(user)).toEqual(plain);
  });
});
