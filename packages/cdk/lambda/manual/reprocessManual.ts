import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  InvokeCommand,
  LambdaClient,
  InvocationType,
} from '@aws-sdk/client-lambda';
import { error, isAdmin, isValidManualId, ok } from './utils';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

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
 * POST /manuals/{manualId}/reprocess
 * Reprocess order (decided 2026-05-29, C-4):
 *   1. set DynamoDB status=processing (and clear error_detail)
 *   2. delete derived S3 artifacts (pages/, toc.*, page_map.json), keep the original
 *   3. invoke the preprocessing Lambda asynchronously (Event)
 * The preprocessing Lambda itself is implemented in phase B4. Until then
 * PREPROCESS_FUNCTION_ARN is empty and the invoke step is skipped (C-5).
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
    if (!isValidManualId(manualId)) {
      return error(400, 'manualId must be a valid UUID');
    }

    const tableName = process.env.TABLE_NAME;
    const bucket = process.env.BUCKET_NAME!;

    const existing = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { manual_id: manualId },
      })
    );
    if (!existing.Item) {
      return error(404, 'Manual not found');
    }

    // 1. status -> processing
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { manual_id: manualId },
        UpdateExpression:
          'SET #status = :processing, error_detail = :empty, updated_at = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':processing': 'processing',
          ':empty': '',
          ':now': new Date().toISOString(),
        },
      })
    );

    // 2. delete derived artifacts (keep the original)
    await deletePrefix(bucket, `${manualId}/pages/`);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: [
            { Key: `${manualId}/toc.md` },
            { Key: `${manualId}/toc.json` },
            { Key: `${manualId}/page_map.json` },
          ],
        },
      })
    );

    // 3. invoke the preprocessing Lambda (wired in B4)
    const preprocessArn = process.env.PREPROCESS_FUNCTION_ARN ?? '';
    if (preprocessArn.length > 0) {
      await lambda.send(
        new InvokeCommand({
          FunctionName: preprocessArn,
          InvocationType: InvocationType.Event,
          Payload: Buffer.from(JSON.stringify({ manual_id: manualId })),
        })
      );
    } else {
      console.log(
        'PREPROCESS_FUNCTION_ARN is not set yet (B4 pending); skipping invoke.'
      );
    }

    return ok({ manualId, status: 'processing' });
  } catch (e) {
    console.log(e);
    return error(500, 'Internal Server Error');
  }
};
