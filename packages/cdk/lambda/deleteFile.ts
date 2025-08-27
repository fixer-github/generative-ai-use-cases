import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteFileRequest } from 'generative-ai-use-cases';
import { getTenantIdFromJWT } from './utils/tenantUtils';
import { createTenantS3Client } from './utils/tenantS3Client';
import { getTenantBucketNameByTenantId, isDefaultTenant } from './utils/tenantS3Utils';

// Constants
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req = event.pathParameters as DeleteFileRequest;
    // Extract tenant ID from JWT token in Authorization header (same as upload)
    const tenantId = await getTenantIdFromJWT(event);
    console.log(`Processing file deletion for tenant: ${tenantId}`);
    console.log(`Request fileName: ${req.fileName}`);

    // Use tenant-specific S3 client and bucket
    let s3Client: S3Client;
    let bucketName: string;

    if (isDefaultTenant(tenantId)) {
      // Default tenant path - simple and clear
      console.log('Using default S3 client and bucket for default tenant');
      s3Client = new S3Client({});
      bucketName = DEFAULT_BUCKET_NAME;
    } else {
      // Tenant-specific path: Use Lambda's IAM role for bucket discovery (same as upload)
      console.log(`Finding tenant bucket using Lambda IAM role for tenant: ${tenantId}`);
      const lambdaS3Client = new S3Client({});
      bucketName = await getTenantBucketNameByTenantId(tenantId, lambdaS3Client, 'chat');
      console.log(`Found tenant bucket: ${bucketName}`);
      
      // Create tenant-specific S3 client for delete operation (maintains tenant isolation)
      console.log(`Creating tenant-specific S3 client for delete operation`);
      s3Client = await createTenantS3Client(event);
    }

    console.log(`Final delete operation - Bucket: ${bucketName}, Key: ${req.fileName}`);
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
