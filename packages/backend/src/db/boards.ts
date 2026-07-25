import { randomUUID } from "node:crypto";
import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  BoardAgreement,
  BoardLayout,
  BoardMeta,
  BoardPosition,
  Placement,
  ScoringFormat,
  SeedTool,
  TierBand,
} from "@drafthelper/shared";
import { ddb, scanAll, TABLE_NAME } from "./client.js";

export interface NewBoard {
  name: string;
  position: BoardPosition;
  scoring: ScoringFormat;
  bands: TierBand[];
  placements: Record<string, Placement>;
  sourceIds?: string[];
  seededBy?: SeedTool;
  /** Per-player consensus stats; only set for consensus-seeded boards. */
  agreement?: BoardAgreement;
}

function toMeta(id: string, item: Record<string, unknown>): BoardMeta {
  return {
    id,
    ownerId: item.ownerId as string,
    name: item.name as string,
    position: item.position as BoardPosition,
    scoring: item.scoring as ScoringFormat,
    bands: (item.bands as TierBand[]) ?? [],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    sourceIds: item.sourceIds as string[] | undefined,
    seededBy: item.seededBy as SeedTool | undefined,
  };
}

export async function createBoard(ownerId: string, input: NewBoard): Promise<BoardMeta> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const items: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
  > = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: `BOARD#${id}`,
          sk: "META",
          ownerId,
          name: input.name,
          position: input.position,
          scoring: input.scoring,
          bands: input.bands,
          createdAt: now,
          updatedAt: now,
          // Omitted when undefined (removeUndefinedValues is on).
          sourceIds: input.sourceIds,
          seededBy: input.seededBy,
        },
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: `BOARD#${id}`,
          sk: "LAYOUT",
          placements: input.placements,
          version: 1,
        },
      },
    },
  ];
  if (input.agreement) {
    items.push({
      Put: {
        TableName: TABLE_NAME,
        Item: { pk: `BOARD#${id}`, sk: "AGREEMENT", stats: input.agreement },
      },
    });
  }
  await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  return toMeta(id, {
    ownerId,
    name: input.name,
    position: input.position,
    scoring: input.scoring,
    bands: input.bands,
    createdAt: now,
    updatedAt: now,
    sourceIds: input.sourceIds,
    seededBy: input.seededBy,
  });
}

/** Scan is fine at league scale; the pk guard keeps source META items out. */
export async function listBoards(ownerId: string): Promise<BoardMeta[]> {
  const items = await scanAll({
    TableName: TABLE_NAME,
    FilterExpression: "sk = :meta AND ownerId = :owner AND begins_with(pk, :prefix)",
    ExpressionAttributeValues: { ":meta": "META", ":owner": ownerId, ":prefix": "BOARD#" },
  });
  return items
    .map((item) => toMeta((item.pk as string).replace(/^BOARD#/, ""), item))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getBoard(
  boardId: string
): Promise<{ meta: BoardMeta; layout: BoardLayout; agreement?: BoardAgreement } | null> {
  const [metaRes, layoutRes, agreementRes] = await Promise.all([
    ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "META" } })
    ),
    ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "LAYOUT" } })
    ),
    ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "AGREEMENT" } })
    ),
  ]);
  if (!metaRes.Item || !layoutRes.Item) return null;
  return {
    meta: toMeta(boardId, metaRes.Item),
    layout: {
      placements: layoutRes.Item.placements as Record<string, Placement>,
      version: layoutRes.Item.version as number,
    },
    agreement: agreementRes.Item?.stats as BoardAgreement | undefined,
  };
}

/** Optimistic concurrency: succeeds only against the expected version. */
export async function putLayout(
  boardId: string,
  placements: Record<string, Placement>,
  expectedVersion: number
): Promise<number | null> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `BOARD#${boardId}`, sk: "LAYOUT" },
        UpdateExpression: "SET placements = :p, version = :next",
        ConditionExpression: "version = :expected",
        ExpressionAttributeValues: {
          ":p": placements,
          ":next": expectedVersion + 1,
          ":expected": expectedVersion,
        },
      })
    );
    return expectedVersion + 1;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw err;
  }
}

/** Updates name and/or bands (canvas band-boundary edits land here). */
export async function updateBoardMeta(
  boardId: string,
  changes: { name?: string; bands?: TierBand[] }
): Promise<BoardMeta | null> {
  const sets: string[] = ["updatedAt = :now"];
  const values: Record<string, unknown> = { ":now": new Date().toISOString() };
  if (changes.name !== undefined) {
    sets.push("#n = :name");
    values[":name"] = changes.name;
  }
  if (changes.bands !== undefined) {
    sets.push("bands = :bands");
    values[":bands"] = changes.bands;
  }
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `BOARD#${boardId}`, sk: "META" },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(pk)",
        ...(changes.name !== undefined
          ? { ExpressionAttributeNames: { "#n": "name" } }
          : {}),
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return res.Attributes ? toMeta(boardId, res.Attributes) : null;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw err;
  }
}

export async function deleteBoard(boardId: string): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "META" } } },
        { Delete: { TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "LAYOUT" } } },
        { Delete: { TableName: TABLE_NAME, Key: { pk: `BOARD#${boardId}`, sk: "AGREEMENT" } } },
      ],
    })
  );
}
