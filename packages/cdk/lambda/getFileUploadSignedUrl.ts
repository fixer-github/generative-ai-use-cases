import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetFileUploadSignedUrlRequest } from 'generative-ai-use-cases';
import { getTenantId } from './utils/tenantUtils';
import { createTenantS3Client } from './utils/tenantS3Client';
import { getTenantBucketName, isDefaultTenant } from './utils/tenantS3Utils';

// Constants
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: GetFileUploadSignedUrlRequest = JSON.parse(event.body!);
    const filename = req.filename;
    const uuid = uuidv4();
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

    // The upload destination is XXXXX/image.png format. The file can be downloaded with the correct file name when downloaded.
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: `${uuid}/${filename}`,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

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
