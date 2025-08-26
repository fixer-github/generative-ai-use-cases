import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetFileUploadSignedUrlRequest } from 'generative-ai-use-cases';
import { getTenantIdFromJWT } from './utils/tenantUtils';
import { createTenantS3Client } from './utils/tenantS3Client';
import { getTenantBucketNameByTenantId, isDefaultTenant } from './utils/tenantS3Utils';

// Constants
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: GetFileUploadSignedUrlRequest = JSON.parse(event.body!);
    const filename = req.filename;
    const uuid = uuidv4();
    
    // Extract tenant ID from JWT token in Authorization header
    const tenantId = await getTenantIdFromJWT(event);
    console.log(`Processing file upload for tenant: ${tenantId}`);
    console.log(`Request filename: ${filename}`);

    // Use tenant-specific S3 client and bucket
    let s3Client: S3Client;
    let bucketName: string;

    if (isDefaultTenant(tenantId)) {
      // Default tenant path - simple and clear
      console.log('Using default S3 client and bucket for default tenant');
      s3Client = new S3Client({});
      bucketName = DEFAULT_BUCKET_NAME;
    } else {
      // Tenant-specific path: Use Lambda's IAM role for bucket discovery
      console.log(`Finding tenant bucket using Lambda IAM role for tenant: ${tenantId}`);
      const lambdaS3Client = new S3Client({});
      bucketName = await getTenantBucketNameByTenantId(tenantId, lambdaS3Client, 'chat');
      console.log(`Found tenant bucket: ${bucketName}`);
      
      // Create tenant-specific S3 client for signed URL generation (maintains tenant isolation)
      console.log(`Creating tenant-specific S3 client for signed URL generation`);
      s3Client = await createTenantS3Client(event);
    }

    // The upload destination is XXXXX/image.png format. The file can be downloaded with the correct file name when downloaded.
    console.log(`Final upload destination - Bucket: ${bucketName}, Key: ${uuid}/${filename}`);
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: `${uuid}/${filename}`,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });
    
    console.log(`Generated signed URL for bucket: ${bucketName}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: signedUrl,
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
