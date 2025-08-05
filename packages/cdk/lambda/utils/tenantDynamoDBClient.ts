import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';
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

  const credentials = await getTenantCredentials(event);

  // Create DynamoDB client with tenant credentials
  const dynamoClient = new DynamoDBClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCache.set(tenantId, dynamoClient);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCache.delete(tenantId), ttl);

  return dynamoClient;
}