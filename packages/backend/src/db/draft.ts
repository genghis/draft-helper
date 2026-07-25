import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
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
  return (res.Items ?? [])
    // Tombstoned rows: a deliberate unmark/undo. They stay in the table so a
    // still-connected extension's cumulative re-push can't resurrect them
    // (putEspnPick refuses a deleted row); they're just hidden from the board.
    .filter((item) => item.deleted !== true)
    .map((item) => ({
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
 * already attributed to the user.
 *
 * Every branch also refuses a tombstoned row (deleted=true): once the user
 * unmarks a pick or resets, the extension's cumulative re-push cannot bring it
 * back. `source`/`mine`/`deleted` are DynamoDB reserved words.
 */
export async function putEspnPick(
  userId: string,
  pick: { playerId: string; mine: boolean; overall: number }
): Promise<boolean> {
  // Passes when the row is absent, or ESPN-sourced and not tombstoned (and,
  // for a non-mine push, not already flagged as the user's own).
  const notDeleted = "(attribute_not_exists(#del) OR #del <> :true)";
  const condition = pick.mine
    ? `attribute_not_exists(pk) OR (#src = :espn AND ${notDeleted})`
    : `attribute_not_exists(pk) OR (#src = :espn AND #mine <> :true AND ${notDeleted})`;
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
          ? { "#src": "source", "#del": "deleted" }
          : { "#src": "source", "#mine": "mine", "#del": "deleted" },
        ExpressionAttributeValues: pick.mine
          ? { ":espn": "espn", ":true": true }
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

/**
 * Unmark/undo is a soft delete: we tombstone the row (deleted=true) rather than
 * remove it, so a still-connected extension re-pushing its cumulative snapshot
 * can't resurrect the pick (putEspnPick refuses a tombstoned row). A later
 * manual re-mark via putPick writes a fresh Item with no `deleted` flag, which
 * deliberately clears the tombstone. `deleted` is a DynamoDB reserved word.
 */
export async function deletePick(userId: string, playerId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DRAFT#${userId}`, sk: `PICK#${playerId}` },
      UpdateExpression: "SET #del = :true, deletedAt = :now",
      ExpressionAttributeNames: { "#del": "deleted" },
      ExpressionAttributeValues: { ":true": true, ":now": new Date().toISOString() },
    })
  );
}

/**
 * Reset is a true fresh slate: hard-delete every PICK# row, tombstones
 * included, so sync can repopulate from scratch. (listPicks hides tombstones,
 * so we query the raw rows here rather than reuse it.) Returns the live count.
 */
export async function resetDraft(userId: string): Promise<number> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :pick)",
      ExpressionAttributeValues: { ":pk": `DRAFT#${userId}`, ":pick": "PICK#" },
      ProjectionExpression: "sk, #del",
      ExpressionAttributeNames: { "#del": "deleted" },
    })
  );
  const items = res.Items ?? [];
  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: items.slice(i, i + 25).map((item) => ({
            DeleteRequest: {
              Key: { pk: `DRAFT#${userId}`, sk: item.sk as string },
            },
          })),
        },
      })
    );
  }
  // Count only live picks removed, not tombstones, so the UI's "cleared N" is honest.
  return items.filter((item) => item.deleted !== true).length;
}
