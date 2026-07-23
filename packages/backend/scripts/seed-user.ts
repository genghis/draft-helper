/**
 * Creates a user and prints their invite link. Run locally with AWS creds:
 *
 *   TABLE_NAME=<table> APP_URL=https://<domain> node scripts/seed-user.ts "Display Name"
 *
 * Node 24 runs .ts directly (type stripping); no build step needed.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const name = process.argv[2];
if (!name) {
  console.error('usage: TABLE_NAME=... node scripts/seed-user.ts "Display Name"');
  process.exit(1);
}
const tableName = process.env.TABLE_NAME;
if (!tableName) {
  console.error("TABLE_NAME env var is required");
  process.exit(1);
}

const userId = randomUUID();
const token = randomBytes(24).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
await ddb.send(
  new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: { pk: `USER#${userId}`, sk: "PROFILE", name, createdAt: new Date().toISOString() },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: { pk: `INVITE#${tokenHash}`, sk: "INVITE", userId },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ],
  })
);

const base = process.env.APP_URL ?? "https://<your-domain>";
console.log(`created user ${userId} (${name})`);
console.log(`invite link: ${base}/api/auth/login?invite=${token}`);
