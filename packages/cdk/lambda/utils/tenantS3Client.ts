import { S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * Create an S3 client with tenant-isolated credentials from Cognito Identity Pool
 * IAM policies automatically restrict access to tenant-specific resources via principal tags
 * NOTE: No caching to ensure proper user isolation within tenants
 */
export async function createTenantS3Client(
  event: APIGatewayProxyEvent
): Promise<S3Client> {
  try {
    // Get fresh credentials for each request to ensure proper user isolation
    const credentials = await getTenantCredentials(event);

    if (!credentials.AccessKeyId || !credentials.SecretKey) {
      throw new Error(
        'Invalid credentials received from Cognito Identity Pool'
      );
    }

    // Create S3 client with Identity Pool credentials
    return new S3Client({
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretKey,
        sessionToken: credentials.SessionToken,
      },
      region: process.env.AWS_REGION!,
    });
  } catch (error) {
    console.error('Failed to create tenant S3 client:', error);
    throw new Error(`Failed to create tenant-isolated S3 client: ${error}`);
  }
}
