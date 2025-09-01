import { S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';

/**
 * Create an S3 client with tenant-isolated credentials from Cognito Identity Pool
 * IAM policies automatically restrict access to tenant-specific resources via principal tags
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

/**
 * Create an S3 client for background jobs
 * Since background jobs work with buckets they already have access to,
 * we simply use the Lambda's own execution role credentials
 */
export async function createTenantS3ClientForBackgroundJob(
  tenantId: string,
  region?: string
): Promise<S3Client> {
  // For background jobs, use the Lambda's own execution role
  // This works because:
  // - For default tenant: copyVideoJob copies from temp to default bucket (both accessible)
  // - For tenant users: no copy is needed (needsCopy: false), just status updates
  return new S3Client({ region: region || process.env.AWS_REGION! });
}
