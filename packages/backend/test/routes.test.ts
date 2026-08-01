import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { startDdb, type TestDdb } from "./support/ddb.js";

// The session secret comes from SSM in production. Stub the client so the real
// signing and verification code still runs — the point is to exercise the auth
// gate, not to bypass it.
vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    async send() {
      return { Parameter: { Value: "test-session-secret" } };
    }
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {}
  },
}));

let ddb: TestDdb;
let app: typeof import("../src/app.js")["app"];
let issueSessionCookie: (userId: string) => Promise<string>;

const USER = "route-user";
const OTHER = "other-user";

function docClient() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: ddb.endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    })
  );
}

async function seedUser(id: string, name: string) {
  const doc = docClient();
  await doc.send(
    new PutCommand({
      TableName: ddb.tableName,
      Item: { pk: `USER#${id}`, sk: "PROFILE", name },
    })
  );
  doc.destroy();
}

let cookie = "";
let otherCookie = "";

/** Issues a request through the real Hono app, authenticated as `USER`. */
function req(path: string, init: RequestInit & { as?: string } = {}) {
  const { as, ...rest } = init;
  return app.request(`/api${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      cookie: as === OTHER ? otherCookie : cookie,
      ...(rest.headers ?? {}),
    },
  });
}

beforeAll(async () => {
  ddb = await startDdb("DraftHelperRoutesTest");
  process.env.TABLE_NAME = ddb.tableName;
  process.env.AWS_ENDPOINT_URL_DYNAMODB = ddb.endpoint;
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.SESSION_SECRET_PARAM = "/test/session-secret";

  ({ app } = await import("../src/app.js"));
  ({ issueSessionCookie } = await import("../src/lib/session.js"));

  await seedUser(USER, "Router");
  await seedUser(OTHER, "Someone Else");
  cookie = (await issueSessionCookie(USER)).split(";")[0]!;
  otherCookie = (await issueSessionCookie(OTHER)).split(";")[0]!;
});

afterAll(async () => {
  await ddb.stop();
});

describe("session gate", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/draft");
    expect(res.status).toBe(401);
  });

  it("rejects a tampered cookie", async () => {
    const res = await app.request("/api/draft", {
      headers: { cookie: `${cookie}tampered` },
    });
    expect(res.status).toBe(401);
  });

  it("admits a valid session", async () => {
    const res = await req("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: USER, name: "Router" });
  });
});

describe("PUT /draft/order", () => {
  const valid = {
    teamCount: 2,
    teams: [{ name: "A" }, { name: "B" }],
    mySlot: 0,
  };

  it("stores a valid order and returns it on GET /draft", async () => {
    const put = await req("/draft/order", { method: "PUT", body: JSON.stringify(valid) });
    expect(put.status).toBe(200);

    const get = await req("/draft");
    expect((await get.json()).order).toEqual(valid);
  });

  it("rejects a seat list that disagrees with teamCount", async () => {
    const res = await req("/draft/order", {
      method: "PUT",
      body: JSON.stringify({ ...valid, teams: [{ name: "A" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range mySlot and team count", async () => {
    for (const body of [
      { ...valid, mySlot: 5 },
      { ...valid, teamCount: 99 },
      { ...valid, teamCount: 1, teams: [{ name: "A" }] },
    ]) {
      expect((await req("/draft/order", { method: "PUT", body: JSON.stringify(body) })).status)
        .toBe(400);
    }
  });

  it("rejects unknown keys on a seat rather than storing them", async () => {
    const res = await req("/draft/order", {
      method: "PUT",
      body: JSON.stringify({
        ...valid,
        teams: [{ name: "A", pk: "USER#route-user", admin: true }, { name: "B" }],
      }),
    });
    expect(res.status).toBe(400);

    // And the forged key was never written.
    const doc = docClient();
    const forged = await doc.send(
      new GetCommand({ TableName: ddb.tableName, Key: { pk: `USER#${USER}`, sk: "PROFILE" } })
    );
    doc.destroy();
    expect(forged.Item?.admin).toBeUndefined();
  });

  it("rejects a malformed body", async () => {
    expect((await req("/draft/order", { method: "PUT", body: "not json" })).status).toBe(400);
  });

  it("keeps each user's order separate", async () => {
    await req("/draft/order", { method: "PUT", body: JSON.stringify(valid) });
    const mine = await (await req("/draft")).json();
    const theirs = await (await req("/draft", { as: OTHER })).json();
    expect(mine.order).toEqual(valid);
    expect(theirs.order).toBeUndefined();
  });
});

describe("PUT /boards/:id", () => {
  it("rejects bands with a gap — the silent tier-misassignment case", async () => {
    const res = await req("/boards", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad",
        position: "OVERALL",
        scoring: "PPR",
        bands: [
          { y0: 0, y1: 100, label: "Tier 1" },
          { y0: 150, y1: 200, label: "Tier 2" },
        ],
        placements: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for a board the caller does not own", async () => {
    const res = await req("/boards/does-not-exist", {
      method: "PUT",
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s when the body changes nothing", async () => {
    // Asserted against a directly-seeded board: POST /boards uses
    // TransactWriteItems, which dynalite does not implement. Seeding keeps the
    // assertion real rather than letting the test pass vacuously.
    const doc = docClient();
    const now = new Date().toISOString();
    for (const [sk, extra] of [
      ["META", { ownerId: USER, name: "Seeded", position: "OVERALL", scoring: "PPR", bands: [], version: 1, createdAt: now, updatedAt: now }],
      ["LAYOUT", { placements: {}, version: 1 }],
    ] as const) {
      await doc.send(
        new PutCommand({ TableName: ddb.tableName, Item: { pk: "BOARD#seeded", sk, ...extra } })
      );
    }
    doc.destroy();

    expect((await req("/boards/seeded", { method: "PUT", body: "{}" })).status).toBe(400);
  });

  it("404s a board owned by someone else", async () => {
    const res = await req("/boards/seeded", {
      method: "PUT",
      body: JSON.stringify({ name: "Hijacked" }),
      as: OTHER,
    });
    expect(res.status).toBe(404);
  });

  it("409s a stale version and 200s a current one", async () => {
    const ok = await req("/boards/seeded", {
      method: "PUT",
      body: JSON.stringify({ name: "Renamed", version: 1 }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);

    const stale = await req("/boards/seeded", {
      method: "PUT",
      body: JSON.stringify({ name: "Loser", version: 1 }),
    });
    expect(stale.status).toBe(409);
  });
});
