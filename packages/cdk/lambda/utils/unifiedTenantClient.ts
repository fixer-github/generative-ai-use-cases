import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId } from './tenantUtils';

// Credential cache - persists across Lambda invocations
interface CachedCredentials {
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
  expiry: number;
}

const credentialsCache = new Map<string, CachedCredentials>();
const stsClient = new STSClient({});

/**
 * Get or refresh STS credentials for a tenant
 */
export async function getTenantCredentials(
  token: string,
  tenantId: string
): Promise<CachedCredentials['credentials']> {
  // Check cache first
  const cached = credentialsCache.get(tenantId);
  if (cached && cached.expiry > Date.now()) {
    console.log(`Using cached credentials for tenant: ${tenantId}`);
    return cached.credentials;
  }

  console.log(`Fetching new STS credentials for tenant: ${tenantId}`);
  
  // Generate unique session name
  const sessionName = `lambda-${tenantId}-${Date.now()}`.substring(0, 64);
  
  try {
    // Assume role with web identity
    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
      RoleSessionName: sessionName,
      WebIdentityToken: token,
      DurationSeconds: 3600, // 1 hour
    });

    const response = await stsClient.send(command);
    
    if (!response.Credentials) {
      throw new Error('Failed to obtain credentials from STS');
    }

    const credentials = {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken!,
    };
    
    // Cache credentials with 5-minute buffer before expiry
    const expiryTime = Date.now() + (3600 - 300) * 1000; // 55 minutes
    credentialsCache.set(tenantId, {
      credentials,
      expiry: expiryTime,
    });

    return credentials;
  } catch (error) {
    console.error('Error getting STS credentials:', error);
    throw new Error(`Failed to get credentials for tenant ${tenantId}: ${error.message}`);
  }
}

/**
 * Create a DynamoDB client with tenant-specific credentials
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  const token = event.headers['Authorization'];
  if (!token) {
    throw new Error('No authorization token provided');
  }

  const tenantId = getTenantId(event);
  const credentials = await getTenantCredentials(token, tenantId);

  return new DynamoDBClient({
    credentials,
    maxAttempts: 3,
  });
}

/**
 * Create an S3 client with tenant-specific credentials
 */
export async function createTenantS3Client(
  event: APIGatewayProxyEvent
): Promise<S3Client> {
  const token = event.headers['Authorization'];
  if (!token) {
    throw new Error('No authorization token provided');
  }

  const tenantId = getTenantId(event);
  const credentials = await getTenantCredentials(token, tenantId);

  return new S3Client({
    credentials,
    maxAttempts: 3,
  });
}

/**
 * Clear expired credentials from cache (optional cleanup)
 */
export function cleanupCredentialsCache(): void {
  const now = Date.now();
  for (const [tenantId, cached] of credentialsCache.entries()) {
    if (cached.expiry <= now) {
      credentialsCache.delete(tenantId);
      console.log(`Removed expired credentials for tenant: ${tenantId}`);
    }
  }
}

/**
 * Get cache statistics (for monitoring)
 */
export function getCacheStats(): { size: number; tenants: string[] } {
  return {
    size: credentialsCache.size,
    tenants: Array.from(credentialsCache.keys()),
  };
}