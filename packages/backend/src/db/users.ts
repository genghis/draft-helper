import { randomBytes, randomUUID } from "node:crypto";
import {
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AdminUserRow, SessionUser } from "@drafthelper/shared";
import { hashInviteToken } from "../lib/session.js";
import { ddb, TABLE_NAME } from "./client.js";

export interface UserProfile extends SessionUser {
  espn?: {
    leagueId: string;
    espnS2: string;
    swid: string;
  };
}

export async function getUser(userId: string): Promise<UserProfile | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: "PROFILE" },
    })
  );
  if (!res.Item) return null;
  return {
    id: userId,
    name: res.Item.name,
    admin: res.Item.admin === true,
    espn: res.Item.espn,
  };
}

/** Invite tokens are stored hashed; the raw token only ever lives in the invite link. */
export async function getUserIdByInviteHash(hash: string): Promise<string | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `INVITE#${hash}`, sk: "INVITE" },
    })
  );
  return res.Item?.userId ?? null;
}

/** Fine as a Scan: the whole league is a dozen profiles. */
export async function listUsers(): Promise<AdminUserRow[]> {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "sk = :profile",
      ExpressionAttributeValues: { ":profile": "PROFILE" },
    })
  );
  return (res.Items ?? [])
    .map((item) => ({
      id: (item.pk as string).replace(/^USER#/, ""),
      name: item.name as string,
      admin: item.admin === true,
      createdAt: (item.createdAt as string) ?? null,
      hasEspnAuth: item.espn != null,
    }))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Returns the raw invite token exactly once; only its hash is persisted. */
export async function createUser(
  name: string
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const { token, hash } = newInviteToken();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: `USER#${id}`,
              sk: "PROFILE",
              name,
              inviteHash: hash,
              createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { pk: `INVITE#${hash}`, sk: "INVITE", userId: id },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ],
    })
  );
  return { id, token };
}

/**
 * Issues a fresh invite link and invalidates the old one (when the profile
 * tracks it — users seeded before inviteHash existed just get a new link).
 */
export async function rotateInvite(userId: string): Promise<string | null> {
  const profile = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${userId}`, sk: "PROFILE" },
    })
  );
  if (!profile.Item) return null;
  const oldHash = profile.Item.inviteHash as string | undefined;
  const { token, hash } = newInviteToken();

  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
  > = [
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: `USER#${userId}`, sk: "PROFILE" },
        UpdateExpression: "SET inviteHash = :hash",
        ExpressionAttributeValues: { ":hash": hash },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { pk: `INVITE#${hash}`, sk: "INVITE", userId },
      },
    },
  ];
  if (oldHash) {
    transactItems.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: { pk: `INVITE#${oldHash}`, sk: "INVITE" },
      },
    });
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  return token;
}
