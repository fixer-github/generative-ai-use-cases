import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';

/**
 * Create a DynamoDB client with tenant-isolated credentials
 * IAM policies automatically restrict access to tenant-specific resources
 * NOTE: No caching to ensure proper user isolation within tenants
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  // Get fresh credentials for each request to ensure proper user isolation
  const credentials = await getTenantCredentials(event);

  // Create DynamoDB client with Cognito Identity credentials
  return new DynamoDBClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretKey!,
      sessionToken: credentials.SessionToken!,
    },
  });
}
