import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createTenantS3Client, getTenantResourceName } from './utils/tenantClientFactory';

/**
 * Example Lambda function demonstrating S3 operations with tenant isolation
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Get the S3 client for the tenant
    const s3Client = await createTenantS3Client(event);
    
    // Get tenant-specific bucket name
    const bucketName = getTenantResourceName(
      process.env.BASE_BUCKET_NAME || 'uploads',
      event
    );

    const operation = event.queryStringParameters?.operation || 'list';

    switch (operation) {
      case 'list':
        // List objects in tenant bucket
        const listCommand = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: event.queryStringParameters?.prefix,
        });
        
        const listResponse = await s3Client.send(listCommand);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            bucket: bucketName,
            objects: listResponse.Contents?.map(obj => ({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified,
            })),
          }),
        };

      case 'upload':
        // Generate presigned URL for upload
        const uploadKey = event.queryStringParameters?.key;
        if (!uploadKey) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ error: 'Key parameter is required for upload' }),
          };
        }

        const putCommand = new PutObjectCommand({
          Bucket: bucketName,
          Key: uploadKey,
        });

        const uploadUrl = await getSignedUrl(s3Client, putCommand, {
          expiresIn: 3600, // 1 hour
        });

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            uploadUrl,
            bucket: bucketName,
            key: uploadKey,
            expiresIn: 3600,
          }),
        };

      case 'download':
        // Generate presigned URL for download
        const downloadKey = event.queryStringParameters?.key;
        if (!downloadKey) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ error: 'Key parameter is required for download' }),
          };
        }

        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: downloadKey,
        });

        const downloadUrl = await getSignedUrl(s3Client, getCommand, {
          expiresIn: 3600, // 1 hour
        });

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            downloadUrl,
            bucket: bucketName,
            key: downloadKey,
            expiresIn: 3600,
          }),
        };

      case 'delete':
        // Delete object from tenant bucket
        const deleteKey = event.queryStringParameters?.key;
        if (!deleteKey) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ error: 'Key parameter is required for delete' }),
          };
        }

        const deleteCommand = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: deleteKey,
        });

        await s3Client.send(deleteCommand);

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            message: 'Object deleted successfully',
            bucket: bucketName,
            key: deleteKey,
          }),
        };

      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Invalid operation' }),
        };
    }
  } catch (error) {
    console.error('Error in S3 operation:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};