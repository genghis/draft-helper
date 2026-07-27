import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Tag, TagColor, TagMeta } from "@drafthelper/shared";
import { ddb, scanAll, TABLE_NAME } from "./client.js";

export interface NewTag {
  label: string;
  color: TagColor;
  playerIds: string[];
  autoManaged?: "handcuff";
  autoAddedIds?: string[];
  autoExcludedIds?: string[];
}

export interface TagChanges {
  label?: string;
  color?: TagColor;
  playerIds?: string[];
  autoManaged?: "handcuff";
  autoAddedIds?: string[];
  autoExcludedIds?: string[];
}

function toMeta(id: string, item: Record<string, unknown>): TagMeta {
  return {
    id,
    ownerId: item.ownerId as string,
    label: item.label as string,
    color: item.color as TagColor,
    playerCount: (item.playerIds as string[] | undefined)?.length ?? 0,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    version: item.version as number,
    ...(item.autoManaged ? { autoManaged: item.autoManaged as "handcuff" } : {}),
  };
}

export async function createTag(ownerId: string, input: NewTag): Promise<TagMeta> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const item = {
    pk: `TAG#${id}`,
    sk: "META",
    ownerId,
    label: input.label,
    color: input.color,
    playerIds: input.playerIds,
    autoAddedIds: input.autoAddedIds ?? [],
    autoExcludedIds: input.autoExcludedIds ?? [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...(input.autoManaged ? { autoManaged: input.autoManaged } : {}),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return toMeta(id, item);
}

/** Scan is fine at league scale; the pk guard keeps other entities out. */
export async function listTags(ownerId: string): Promise<TagMeta[]> {
  const items = await scanAll({
    TableName: TABLE_NAME,
    FilterExpression: "sk = :meta AND ownerId = :owner AND begins_with(pk, :prefix)",
    ExpressionAttributeValues: { ":meta": "META", ":owner": ownerId, ":prefix": "TAG#" },
  });
  return items
    .map((item) => toMeta((item.pk as string).replace(/^TAG#/, ""), item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getTag(tagId: string): Promise<Tag | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: `TAG#${tagId}`, sk: "META" } })
  );
  if (!res.Item) return null;
  return {
    meta: toMeta(tagId, res.Item),
    playerIds: (res.Item.playerIds as string[]) ?? [],
    autoAddedIds: (res.Item.autoAddedIds as string[]) ?? [],
    autoExcludedIds: (res.Item.autoExcludedIds as string[]) ?? [],
  };
}

/** Optimistic concurrency: succeeds only against the expected version. */
export async function updateTag(
  tagId: string,
  changes: TagChanges,
  expectedVersion: number
): Promise<TagMeta | null> {
  const sets: string[] = ["updatedAt = :now", "version = :nextVersion"];
  const values: Record<string, unknown> = {
    ":now": new Date().toISOString(),
    ":nextVersion": expectedVersion + 1,
    ":expectedVersion": expectedVersion,
  };
  const names: Record<string, string> = {};
  if (changes.label !== undefined) {
    sets.push("#l = :label");
    names["#l"] = "label";
    values[":label"] = changes.label;
  }
  if (changes.color !== undefined) {
    sets.push("#c = :color");
    names["#c"] = "color";
    values[":color"] = changes.color;
  }
  if (changes.playerIds !== undefined) {
    sets.push("playerIds = :playerIds");
    values[":playerIds"] = changes.playerIds;
  }
  if (changes.autoManaged !== undefined) {
    sets.push("autoManaged = :autoManaged");
    values[":autoManaged"] = changes.autoManaged;
  }
  if (changes.autoAddedIds !== undefined) {
    sets.push("autoAddedIds = :autoAddedIds");
    values[":autoAddedIds"] = changes.autoAddedIds;
  }
  if (changes.autoExcludedIds !== undefined) {
    sets.push("autoExcludedIds = :autoExcludedIds");
    values[":autoExcludedIds"] = changes.autoExcludedIds;
  }
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `TAG#${tagId}`, sk: "META" },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(pk) AND version = :expectedVersion",
        ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return res.Attributes ? toMeta(tagId, res.Attributes) : null;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw err;
  }
}

export async function deleteTag(tagId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: `TAG#${tagId}`, sk: "META" } })
  );
}
