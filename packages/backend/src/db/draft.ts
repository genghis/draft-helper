import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DraftOrder, DraftSync, Pick, PickSource } from "@drafthelper/shared";
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
      espnTeamId: item.espnTeamId as number | undefined,
    }));
}

/**
 * Marks a pick, updating only the fields a manual mark owns. It must NOT be a
 * whole-item Put: marking a player the extension already synced would drop
 * `overall` and `espnTeamId`, and putEspnPick's condition (source must be
 * "espn") means the extension could never put them back. That erasure is
 * worst exactly where it hurts most — hitting "Mine" on your own pick is what
 * deriveOrder reads to learn your seat, so the turn banner would go dark for
 * the rest of the draft. REMOVE #del un-tombstones a previously unmarked row.
 */
export async function putPick(
  userId: string,
  playerId: string,
  opts: { mine: boolean; source: PickSource; overall?: number }
): Promise<Pick> {
  const pickedAt = new Date().toISOString();
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DRAFT#${userId}`, sk: `PICK#${playerId}` },
      UpdateExpression:
        "SET playerId = :pid, #src = :src, #mine = :mine, pickedAt = :at" +
        (opts.overall !== undefined ? ", overall = :ov" : "") +
        " REMOVE #del, deletedAt",
      ExpressionAttributeNames: { "#src": "source", "#mine": "mine", "#del": "deleted" },
      ExpressionAttributeValues: {
        ":pid": playerId,
        ":src": opts.source,
        ":mine": opts.mine,
        ":at": pickedAt,
        ...(opts.overall !== undefined ? { ":ov": opts.overall } : {}),
      },
      ReturnValues: "ALL_NEW",
    })
  );
  const item = res.Attributes ?? {};
  return {
    playerId,
    source: opts.source,
    mine: opts.mine,
    pickedAt,
    overall: item.overall as number | undefined,
    espnTeamId: item.espnTeamId as number | undefined,
  };
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
  pick: { playerId: string; mine: boolean; overall: number; teamId?: number }
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
          // Kept so the running board can name the drafter, not just flag "mine".
          // ESPN team ids are 1-based: the extension's DOM rescan sends 0 for
          // "couldn't tell who picked", which must stay absent rather than
          // become a team every rescan pick binds to.
          ...(pick.teamId !== undefined && pick.teamId > 0
            ? { espnTeamId: pick.teamId }
            : {}),
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
 * manual re-mark via putPick REMOVEs the `deleted` flag, which deliberately
 * clears the tombstone. `deleted` is a DynamoDB reserved word.
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
  // The seat list survives (names and "which seat is mine" are league facts worth
  // keeping across mocks), but the ESPN team ids learned from the last draft do
  // not: they are invisible in the UI, there is no way to clear them by hand, and
  // a stale mapping would silently misattribute the next draft's picks.
  // Best-effort: the picks are already deleted, so a failure here must not turn
  // a completed reset into a 500. Stale links are recoverable (unlink a seat);
  // a reset that reports failure after succeeding is not.
  try {
    const order = await getDraftOrder(userId);
    if (order?.teams?.some((t) => t.espnTeamId !== undefined)) {
      await putDraftOrder(userId, {
        ...order,
        teams: order.teams.map((t) => ({ name: t.name })),
      });
    }
  } catch {
    // Leave the seat links; the user can unlink them by hand.
  }
  // Count only live picks removed, not tombstones, so the UI's "cleared N" is honest.
  return items.filter((item) => item.deleted !== true).length;
}

/**
 * The draft order (team seats + which is the user's). One document per user,
 * alongside their picks; last write wins, like the rest of the draft record.
 */
export async function getDraftOrder(userId: string): Promise<DraftOrder | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: `DRAFT#${userId}`, sk: "ORDER" } })
  );
  const item = res.Item;
  if (!item) return undefined;
  return {
    teamCount: item.teamCount as number,
    teams: (item.teams as DraftOrder["teams"] | undefined) ?? [],
    mySlot: (item.mySlot ?? null) as number | null,
  };
}

export async function putDraftOrder(userId: string, order: DraftOrder): Promise<DraftOrder> {
  // Rebuilt field by field, never spread from the request body: a spread would
  // let a caller-supplied pk/sk override the key above and write any item in
  // the table. Validation checks the fields we need, not the ones we don't.
  const clean: DraftOrder = {
    teamCount: order.teamCount,
    teams: order.teams.map((t) => ({
      name: t.name,
      ...(t.espnTeamId !== undefined ? { espnTeamId: t.espnTeamId } : {}),
    })),
    mySlot: order.mySlot,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `DRAFT#${userId}`, sk: "ORDER", ...clean },
    })
  );
  return clean;
}
