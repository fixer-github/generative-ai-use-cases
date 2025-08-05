import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';

// Cache for DynamoDB client with assumed role credentials
let cachedClient: DynamoDBClient | null = null;
let cacheExpiry: number = 0;

/**
 * Create a DynamoDB client with tenant-isolated credentials
 * IAM policies automatically restrict access to tenant-specific resources
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  // Return cached client if still valid
  if (cachedClient && Date.now() < cacheExpiry) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create DynamoDB client with assumed role credentials
  cachedClient = new DynamoDBClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Set cache expiry with 5 minute buffer
  cacheExpiry = credentials.Expiration ? 
    credentials.Expiration.getTime() - 5 * 60 * 1000 : 
    Date.now() + 55 * 60 * 1000;

  return cachedClient;
}