import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const stsClient = new STSClient({});

async function getS3ClientForTenant(token: string): Promise<S3Client> {
  const sessionName = `s3-session-${Date.now()}`.substring(0, 64);
  
  const assumeRoleCommand = new AssumeRoleWithWebIdentityCommand({
    RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
    RoleSessionName: sessionName,
    WebIdentityToken: token,
    DurationSeconds: 3600,
  });

  const stsResponse = await stsClient.send(assumeRoleCommand);
  
  if (!stsResponse.Credentials) {
    throw new Error('Failed to obtain credentials from STS');
  }

  return new S3Client({
    credentials: {
      accessKeyId: stsResponse.Credentials.AccessKeyId!,
      secretAccessKey: stsResponse.Credentials.SecretAccessKey!,
      sessionToken: stsResponse.Credentials.SessionToken!,
    },
  });
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const token = event.headers['Authorization'];
    if (!token) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Authorization token required',
        }),
      };
    }

    const s3Client = await getS3ClientForTenant(token);
    const operation = event.pathParameters?.operation;
    const bucketName = process.env.BUCKET_NAME!;
    
    // Extract tenant ID from the token claims
    // In a real implementation, you would decode the JWT to get the tenant ID
    // For now, we'll use a placeholder
    const tenantId = event.requestContext.authorizer?.claims?.['custom:tenantId'] || 'default';
    const prefix = `tenant/${tenantId}/`;

    switch (operation) {
      case 'list': {
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
        });
        const response = await s3Client.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            objects: response.Contents?.map(obj => ({
              key: obj.Key?.replace(prefix, ''),
              size: obj.Size,
              lastModified: obj.LastModified,
            })) || [],
          }),
        };
      }

      case 'upload-url': {
        const { key, contentType } = JSON.parse(event.body || '{}');
        if (!key) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key is required' }),
          };
        }

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: `${prefix}${key}`,
          ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ uploadUrl }),
        };
      }

      case 'download-url': {
        const { key } = JSON.parse(event.body || '{}');
        if (!key) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key is required' }),
          };
        }

        const command = new GetObjectCommand({
          Bucket: bucketName,
          Key: `${prefix}${key}`,
        });

        const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ downloadUrl }),
        };
      }

      case 'delete': {
        const { key } = JSON.parse(event.body || '{}');
        if (!key) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key is required' }),
          };
        }

        const command = new DeleteObjectCommand({
          Bucket: bucketName,
          Key: `${prefix}${key}`,
        });

        await s3Client.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Object deleted successfully' }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Invalid operation' }),
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
        message: 'S3 operation failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};