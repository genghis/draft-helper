import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME = process.env.TABLE_NAME ?? "drafthelper";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Runs a Scan across all pages. A single ScanCommand returns at most one 1 MB
 * page, so without following LastEvaluatedKey a growing table silently drops
 * items a user should see — draining every page keeps listings complete.
 */
export async function scanAll(
  input: Omit<ScanCommandInput, "ExclusiveStartKey">
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({ ...input, ExclusiveStartKey: startKey })
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}
