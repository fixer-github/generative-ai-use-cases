import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId } from './tenantUtils';

// Cache for tenant-specific DynamoDB clients
const clientCache = new Map<string, DynamoDBClient>();

/**
 * Create a tenant-specific DynamoDB client using AssumeRoleWithWebIdentity
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCache.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  // Extract JWT token from Authorization header
  const authHeader = event.headers.Authorization || event.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization token found');
  }
  
  const idToken = authHeader.substring(7);

  try {
    // Assume role with web identity
    const stsClient = new STSClient({});
    const { Credentials } = await stsClient.send(
      new AssumeRoleWithWebIdentityCommand({
        RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
        RoleSessionName: `tenant-${tenantId}-${Date.now()}`,
        WebIdentityToken: idToken,
        DurationSeconds: 3600,
      })
    );

    if (!Credentials) {
      throw new Error('Failed to obtain credentials');
    }

    // Create DynamoDB client with tenant credentials
    const dynamoClient = new DynamoDBClient({
      credentials: {
        accessKeyId: Credentials.AccessKeyId!,
        secretAccessKey: Credentials.SecretAccessKey!,
        sessionToken: Credentials.SessionToken!,
      },
    });

    // Cache client with expiration
    clientCache.set(tenantId, dynamoClient);
    setTimeout(() => clientCache.delete(tenantId), 50 * 60 * 1000);

    return dynamoClient;
  } catch (error) {
    console.error('AssumeRoleWithWebIdentity failed:', error);
    throw new Error(`Failed to create tenant DynamoDB client: ${error}`);
  }
}