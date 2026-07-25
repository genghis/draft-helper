import { randomUUID } from "node:crypto";
import {
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { BoardPosition, ScoringFormat, Source, SourceMeta } from "@drafthelper/shared";
import type { RankedPlayer } from "@drafthelper/shared";
import { ddb, TABLE_NAME } from "./client.js";

export interface NewSource {
  name: string;
  scope: BoardPosition;
  scoring: ScoringFormat;
  entries: RankedPlayer[];
}

function toMeta(id: string, item: Record<string, unknown>): SourceMeta {
  return {
    id,
    ownerId: item.ownerId as string,
    name: item.name as string,
    scope: item.scope as BoardPosition,
    scoring: item.scoring as ScoringFormat,
    entryCount: (item.entryCount as number) ?? 0,
    createdAt: item.createdAt as string,
  };
}

export async function createSource(ownerId: string, input: NewSource): Promise<SourceMeta> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              pk: `SOURCE#${id}`,
              sk: "META",
              ownerId,
              name: input.name,
              scope: input.scope,
              scoring: input.scoring,
              entryCount: input.entries.length,
              createdAt: now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { pk: `SOURCE#${id}`, sk: "ENTRIES", entries: input.entries },
          },
        },
      ],
    })
  );
  return {
    id,
    ownerId,
    name: input.name,
    scope: input.scope,
    scoring: input.scoring,
    entryCount: input.entries.length,
    createdAt: now,
  };
}

/** Scan is fine at league scale; the pk guard keeps board META items out. */
export async function listSources(ownerId: string): Promise<SourceMeta[]> {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "sk = :meta AND ownerId = :owner AND begins_with(pk, :prefix)",
      ExpressionAttributeValues: { ":meta": "META", ":owner": ownerId, ":prefix": "SOURCE#" },
    })
  );
  return (res.Items ?? [])
    .map((item) => toMeta((item.pk as string).replace(/^SOURCE#/, ""), item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSource(sourceId: string): Promise<Source | null> {
  const [metaRes, entriesRes] = await Promise.all([
    ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: `SOURCE#${sourceId}`, sk: "META" } })
    ),
    ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: `SOURCE#${sourceId}`, sk: "ENTRIES" } })
    ),
  ]);
  if (!metaRes.Item || !entriesRes.Item) return null;
  return {
    meta: toMeta(sourceId, metaRes.Item),
    entries: (entriesRes.Item.entries as RankedPlayer[]) ?? [],
  };
}

export async function deleteSource(sourceId: string): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE_NAME, Key: { pk: `SOURCE#${sourceId}`, sk: "META" } } },
        { Delete: { TableName: TABLE_NAME, Key: { pk: `SOURCE#${sourceId}`, sk: "ENTRIES" } } },
      ],
    })
  );
}
