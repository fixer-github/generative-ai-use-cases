import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { error, isAdmin, ok } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * GET /manuals
 * Returns all manuals in this environment. The number of manuals per environment
 * is expected to be small, so a Scan (no GSI) is sufficient (decided 2026-05-29).
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return error(403, 'Forbidden: admin group required');
    }

    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    do {
      const res: ScanCommandOutput = await ddb.send(
        new ScanCommand({
          TableName: process.env.TABLE_NAME,
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );
      items.push(...(res.Items ?? []));
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return ok({ manuals: items });
  } catch (e) {
    console.log(e);
    return error(500, 'Internal Server Error');
  }
};
