import { randomBytes } from "node:crypto";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { hashInviteToken } from "../lib/session.js";
import { ddb, TABLE_NAME } from "./client.js";

/**
 * Bearer tokens for the draft-room browser extension. Same shape as invite
 * tokens: raw value shown exactly once, only the SHA-256 hash persisted, with
 * a reverse-lookup item and a pointer on the profile for rotation.
 */

export async function getUserIdByExtTokenHash(hash: string): Promise<string | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `EXTTOKEN#${hash}`, sk: "TOKEN" },
    })
  );
  return res.Item?.userId ?? null;
}

/** Issues a fresh extension token, revoking any previous one. */
export async function createExtToken(userId: string): Promise<string | null> {
  const profile = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: "PROFILE" },
    })
  );
  if (!profile.Item) return null;
  const oldHash = profile.Item.extTokenHash as string | undefined;
  const token = randomBytes(24).toString("base64url");
  const hash = hashInviteToken(token);

  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
  > = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: `USER#${userId}`, sk: "PROFILE" },
        UpdateExpression: "SET extTokenHash = :hash",
        ExpressionAttributeValues: { ":hash": hash },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { pk: `EXTTOKEN#${hash}`, sk: "TOKEN", userId },
      },
    },
  ];
  if (oldHash) {
    transactItems.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: { pk: `EXTTOKEN#${oldHash}`, sk: "TOKEN" },
      },
    });
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return token;
}

export async function revokeExtToken(userId: string): Promise<void> {
  const profile = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: "PROFILE" },
    })
  );
  const oldHash = profile.Item?.extTokenHash as string | undefined;
  if (!oldHash) return;
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { pk: `USER#${userId}`, sk: "PROFILE" },
            UpdateExpression: "REMOVE extTokenHash",
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { pk: `EXTTOKEN#${oldHash}`, sk: "TOKEN" },
          },
        },
      ],
    })
  );
}
