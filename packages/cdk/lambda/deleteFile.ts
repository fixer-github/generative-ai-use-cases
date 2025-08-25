import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteFileRequest } from 'generative-ai-use-cases';
import { getTenantId } from './utils/tenantUtils';
import { createTenantS3Client } from './utils/tenantS3Client';
import { getTenantBucketName, isDefaultTenant } from './utils/tenantS3Utils';

// Constants
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req = event.pathParameters as DeleteFileRequest;
    const tenantId = getTenantId(event);

    // Use tenant-specific S3 client and bucket
    let s3Client: S3Client;
    let bucketName: string;

    if (isDefaultTenant(tenantId)) {
      // Default tenant path - simple and clear
      s3Client = new S3Client({});
      bucketName = DEFAULT_BUCKET_NAME;
    } else {
      // Tenant-specific path
      s3Client = await createTenantS3Client(event);
      bucketName = await getTenantBucketName(event, s3Client, 'chat');
    }

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: req.fileName,
    });

    await s3Client.send(command);

    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
