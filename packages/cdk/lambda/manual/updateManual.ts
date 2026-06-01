import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { error, isAdmin, ok } from './utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface UpdateManualRequest {
  title?: string;
  description?: string;
}

/**
 * PATCH /manuals/{manualId}
 * Updates the editable metadata (title / description). Only the provided fields
 * are changed. The item must already exist (guarded by a condition).
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return error(403, 'Forbidden: admin group required');
    }

    const manualId = event.pathParameters?.manualId;
    if (!manualId) {
      return error(400, 'manualId is required');
    }

    const req: UpdateManualRequest = JSON.parse(event.body ?? '{}');
    if (req.title === undefined && req.description === undefined) {
      return error(400, 'title or description is required');
    }

    const setExpressions: string[] = ['updated_at = :now'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {
      ':now': new Date().toISOString(),
    };

    // Use ExpressionAttributeNames to avoid any DynamoDB reserved-word collision.
    if (req.title !== undefined) {
      setExpressions.push('#title = :title');
      names['#title'] = 'title';
      values[':title'] = req.title;
    }
    if (req.description !== undefined) {
      setExpressions.push('#description = :description');
      names['#description'] = 'description';
      values[':description'] = req.description;
    }

    const res = await ddb.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { manual_id: manualId },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(manual_id)',
        ReturnValues: 'ALL_NEW',
      })
    );

    return ok({ manual: res.Attributes });
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return error(404, 'Manual not found');
    }
    console.log(e);
    return error(500, 'Internal Server Error');
  }
};
