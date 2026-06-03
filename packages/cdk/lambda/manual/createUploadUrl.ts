import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  error,
  isAdmin,
  ok,
  stripExtension,
  validateUploadFormat,
} from './utils';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Presigned PUT URL validity (decided 2026-05-29: 15 minutes).
const URL_EXPIRES_IN = 15 * 60;

interface CreateUploadUrlRequest {
  filename: string;
  contentType?: string;
  title?: string;
  description?: string;
}

/**
 * POST /manuals
 * Issues a presigned PUT URL for a manual original and immediately creates the
 * DynamoDB metadata item with status=processing (D1 case 1).
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return error(403, 'Forbidden: admin group required');
    }

    const req: CreateUploadUrlRequest = JSON.parse(event.body ?? '{}');
    if (!req.filename) {
      return error(400, 'filename is required');
    }

    const check = validateUploadFormat(req.filename, req.contentType);
    if (!check.valid) {
      return error(400, check.reason ?? 'Unsupported file format');
    }

    const manualId = uuidv4();
    const key = `${manualId}/original.${check.ext}`;
    const now = new Date().toISOString();

    await ddb.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          manual_id: manualId,
          title: req.title || stripExtension(req.filename),
          description: req.description ?? '',
          status: 'processing',
          error_detail: '',
          page_count: 0,
          original_filename: req.filename,
          created_at: now,
          updated_at: now,
        },
      })
    );

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: key,
        ContentType: req.contentType,
      }),
      { expiresIn: URL_EXPIRES_IN }
    );

    return ok({ manualId, key, uploadUrl });
  } catch (e) {
    console.log(e);
    return error(500, 'Internal Server Error');
  }
};
