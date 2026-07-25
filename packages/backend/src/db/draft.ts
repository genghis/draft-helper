import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DraftSync, Pick, PickSource } from "@drafthelper/shared";
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

/**
 * Writes an ESPN-observed pick without ever clobbering a manual mark: the
 * conditional put succeeds when the item is new or already ESPN-sourced
 * (re-pushes are idempotent). Returns false when a manual mark won.
 *
 * A push that does NOT claim the pick as the user's own additionally refuses
 * to downgrade an existing mine=true — so a later DOM-rescan (which can't
 * reliably tell whose pick it is) can never un-flag a pick a WebSocket frame
 * already attributed to the user. `source`/`mine` are DynamoDB reserved words.
 */
export async function putEspnPick(
  userId: string,
  pick: { playerId: string; mine: boolean; overall: number }
): Promise<boolean> {
  const condition = pick.mine
    ? "attribute_not_exists(pk) OR #src = :espn"
    : "attribute_not_exists(pk) OR (#src = :espn AND #mine <> :true)";
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `DRAFT#${userId}`,
          sk: `PICK#${pick.playerId}`,
          playerId: pick.playerId,
          source: "espn",
          mine: pick.mine,
          pickedAt: new Date().toISOString(),
          overall: pick.overall,
        },
        ConditionExpression: condition,
        ExpressionAttributeNames: pick.mine
          ? { "#src": "source" }
          : { "#src": "source", "#mine": "mine" },
        ExpressionAttributeValues: pick.mine
          ? { ":espn": "espn" }
          : { ":espn": "espn", ":true": true },
      })
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}

/** Records that the extension just pushed; the sync-health chip reads this. */
export async function touchDraftMeta(userId: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `DRAFT#${userId}`,
        sk: "META",
        lastExtPushAt: new Date().toISOString(),
      },
    })
  );
}

export async function getDraftSync(userId: string): Promise<DraftSync> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DRAFT#${userId}`, sk: "META" },
    })
  );
  return { lastPushAt: (res.Item?.lastExtPushAt as string) ?? null };
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
