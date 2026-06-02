import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// An original object key looks like "{manual_id}/original.{ext}" (mirrors the
// preprocessing Lambda's _ORIGINAL_KEY_RE).
const ORIGINAL_KEY_RE = /^([^/]+)\/original\.[A-Za-z0-9]+$/;

// The async failure destination receives an envelope wrapping the ORIGINAL event
// that was sent to the preprocessing Lambda, so we recover manual ids the same way
// the preprocessing handler does: from a reprocess payload ({ manual_id }) or from
// the S3 ObjectCreated records.
const extractManualIds = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const p = payload as {
    manual_id?: unknown;
    Records?: Array<{ s3?: { object?: { key?: unknown } } }>;
  };
  if (typeof p.manual_id === 'string' && p.manual_id.length > 0) {
    return [p.manual_id];
  }
  const ids: string[] = [];
  for (const record of p.Records ?? []) {
    const rawKey = record?.s3?.object?.key;
    if (typeof rawKey !== 'string') {
      continue;
    }
    // S3 event keys are URL-encoded with '+' for spaces (urllib unquote_plus).
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const match = key.match(ORIGINAL_KEY_RE);
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
};

interface AsyncFailureEvent {
  requestPayload?: unknown;
  requestContext?: { condition?: string };
}

/**
 * onFailure destination for the preprocessing Lambda.
 *
 * The preprocessing handler catches ordinary exceptions and records status=failed
 * itself, but a hard failure (Lambda timeout / out-of-memory) kills the process
 * before that runs, leaving the manual stuck at status=processing forever. This
 * Lambda is invoked by the async failure destination after retries are exhausted
 * and flips such stuck items to failed.
 *
 * The update is conditional on status still being "processing" so a late
 * destination misfire cannot clobber a manual that actually completed (or was
 * already marked failed). The processing lock attributes are cleared at the same
 * time.
 */
export const handler = async (event: AsyncFailureEvent): Promise<void> => {
  const manualIds = extractManualIds(event?.requestPayload);
  const condition = event?.requestContext?.condition ?? 'Unknown';
  const detail = `Hard failure during preprocessing (likely timeout or out-of-memory): ${condition}`;
  const now = new Date().toISOString();

  for (const manualId of manualIds) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { manual_id: manualId },
          UpdateExpression:
            'SET #status = :failed, error_detail = :detail, updated_at = :now REMOVE lock_owner, lock_expires_at',
          ConditionExpression:
            'attribute_exists(manual_id) AND #status = :processing',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':processing': 'processing',
            ':detail': detail,
            ':now': now,
          },
        })
      );
      console.log(`Marked manual ${manualId} as failed (${condition}).`);
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Item is already terminal (completed / failed) or was deleted; skip.
        continue;
      }
      console.log(e);
    }
  }
};
