import {
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Pick, PickSource } from "@drafthelper/shared";
import { ddb, TABLE_NAME } from "./client.js";

/**
 * Phase 1: each user has one implicit draft (their real draft for the
 * season). Picks are keyed by player, so marking is idempotent and undo is a
 * delete. ESPN sync (Phase 2) writes the same items with source "espn".
 */

export async function listPicks(userId: string): Promise<Pick[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :pick)",
      ExpressionAttributeValues: { ":pk": `DRAFT#${userId}`, ":pick": "PICK#" },
    })
  );
  return (res.Items ?? []).map((item) => ({
    playerId: item.playerId as string,
    source: item.source as PickSource,
    mine: item.mine === true,
    pickedAt: item.pickedAt as string,
    overall: item.overall as number | undefined,
  }));
}

export async function putPick(
  userId: string,
  playerId: string,
  opts: { mine: boolean; source: PickSource; overall?: number }
): Promise<Pick> {
  const pick: Pick = {
    playerId,
    source: opts.source,
    mine: opts.mine,
    pickedAt: new Date().toISOString(),
    overall: opts.overall,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `DRAFT#${userId}`, sk: `PICK#${playerId}`, ...pick },
    })
  );
  return pick;
}

export async function deletePick(userId: string, playerId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DRAFT#${userId}`, sk: `PICK#${playerId}` },
    })
  );
}

export async function resetDraft(userId: string): Promise<number> {
  const picks = await listPicks(userId);
  for (let i = 0; i < picks.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: picks.slice(i, i + 25).map((p) => ({
            DeleteRequest: {
              Key: { pk: `DRAFT#${userId}`, sk: `PICK#${p.playerId}` },
            },
          })),
        },
      })
    );
  }
  return picks.length;
}
