import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { error, isAdmin, ok } from './utils';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Delete every object under the given prefix (handles pagination).
const deletePrefix = async (bucket: string, prefix: string): Promise<void> => {
  let continuationToken: string | undefined = undefined;
  do {
    const listed: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const keys = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k);
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
};

/**
 * DELETE /manuals/{manualId}
 * Removes the DynamoDB item and all S3 objects (original + derived artifacts)
 * under the manual prefix.
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

    await deletePrefix(process.env.BUCKET_NAME!, `${manualId}/`);

    await ddb.send(
      new DeleteCommand({
        TableName: process.env.TABLE_NAME,
        Key: { manual_id: manualId },
      })
    );

    return ok({ manualId, deleted: true });
  } catch (e) {
    console.log(e);
    return error(500, 'Internal Server Error');
  }
};
