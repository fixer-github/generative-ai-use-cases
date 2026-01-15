import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { verifyToken } from './utils/auth';
import {
  badRequest400Response,
  conflict409Response,
  internalServerError500Response,
  ok200Response,
  unauthorized401Response,
} from './utils/apiResponse';

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME!;

const MAX_METADATA_SIZE_BYTES = 100 * 1024; // 100KB

type MetadataValue = string | boolean;
type UserMetadata = Record<string, MetadataValue>;

interface PutUserMetadataRequest {
  metadata: UserMetadata;
  mode?: 'merge' | 'replace';
}

interface PutUserMetadataResponse {
  message: string;
  metadata: UserMetadata;
}

function validateMetadata(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) {
    return 'metadata is required';
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 'metadata must be an object';
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key !== 'string' || key.length === 0) {
      return 'metadata keys must be non-empty strings';
    }
    if (typeof value !== 'string' && typeof value !== 'boolean') {
      return `metadata value for key "${key}" must be a string or boolean`;
    }
  }

  const size = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (size > MAX_METADATA_SIZE_BYTES) {
    return `metadata exceeds maximum size of ${MAX_METADATA_SIZE_BYTES} bytes`;
  }

  return null;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return unauthorized401Response({
        message: 'Authorization header is required',
      });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const claims = await verifyToken(token);
    if (!claims) {
      return unauthorized401Response({ message: 'Invalid or expired token' });
    }

    const userId = claims.sub;
    if (!userId) {
      return unauthorized401Response({
        message: 'User ID not found in token',
      });
    }

    let requestBody: PutUserMetadataRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch {
      return badRequest400Response({ message: 'Invalid JSON in request body' });
    }

    const validationError = validateMetadata(requestBody.metadata);
    if (validationError) {
      return badRequest400Response({ message: validationError });
    }

    if (
      requestBody.mode !== undefined &&
      !['merge', 'replace'].includes(requestBody.mode)
    ) {
      return badRequest400Response({
        message: 'mode must be merge or replace',
      });
    }

    const mode = requestBody.mode || 'merge';
    const newMetadata = requestBody.metadata;

    let finalMetadata: UserMetadata;

    if (mode === 'replace') {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
          Key: { userId },
          UpdateExpression:
            'SET metadata = :metadata, metadataUpdatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':metadata': newMetadata,
            ':updatedAt': new Date().toISOString(),
          },
        })
      );
      finalMetadata = newMetadata;
    } else {
      const existingResult = await docClient.send(
        new GetCommand({
          TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
          Key: { userId },
          ProjectionExpression: 'metadata, metadataUpdatedAt',
        })
      );

      const existingMetadata =
        (existingResult.Item?.metadata as UserMetadata) || {};
      const prevUpdatedAt =
        (existingResult.Item?.metadataUpdatedAt as string | undefined) ?? null;
      finalMetadata = { ...existingMetadata, ...newMetadata };

      const mergedSize = Buffer.byteLength(
        JSON.stringify(finalMetadata),
        'utf8'
      );
      if (mergedSize > MAX_METADATA_SIZE_BYTES) {
        return badRequest400Response({
          message: `merged metadata exceeds maximum size of ${MAX_METADATA_SIZE_BYTES} bytes`,
        });
      }

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
            Key: { userId },
            UpdateExpression:
              'SET metadata = :metadata, metadataUpdatedAt = :updatedAt',
            ConditionExpression:
              'attribute_not_exists(metadataUpdatedAt) OR metadataUpdatedAt = :prevUpdatedAt',
            ExpressionAttributeValues: {
              ':metadata': finalMetadata,
              ':updatedAt': new Date().toISOString(),
              ':prevUpdatedAt': prevUpdatedAt,
            },
          })
        );
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          return conflict409Response({
            message:
              'Metadata was modified by another request. Please retry the operation.',
          });
        }
        throw error;
      }
    }

    return ok200Response<PutUserMetadataResponse>({
      message: 'Metadata updated successfully',
      metadata: finalMetadata,
    });
  } catch (error) {
    console.error('Error updating user metadata:', error);
    return internalServerError500Response({
      message: 'Failed to update user metadata',
    });
  }
};
