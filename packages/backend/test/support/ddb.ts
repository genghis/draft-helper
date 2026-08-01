import dynalite from "dynalite";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Server } from "node:http";

/**
 * An in-process DynamoDB for tests. The db layer's bugs live in expression
 * semantics — what a Put clobbers that an Update preserves, which functions a
 * ConditionExpression actually admits — and none of that is visible to
 * typecheck, to a unit test of pure logic, or to a mock that asserts on the
 * command we just built. Only a real engine evaluating the real expression
 * catches them, so these tests talk to one.
 */
export interface TestDdb {
  endpoint: string;
  tableName: string;
  stop: () => Promise<void>;
}

export async function startDdb(tableName = "DraftHelperTest"): Promise<TestDdb> {
  const server = dynalite({ createTableMs: 0 }) as Server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dynalite did not bind a port");
  }
  const endpoint = `http://127.0.0.1:${address.port}`;

  const client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
  client.destroy();

  return {
    endpoint,
    tableName,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
