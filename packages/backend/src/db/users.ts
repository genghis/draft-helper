import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { SessionUser } from "@drafthelper/shared";
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
  return { id: userId, name: res.Item.name, espn: res.Item.espn };
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
