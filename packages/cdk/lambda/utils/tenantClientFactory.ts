import { APIGatewayProxyEvent } from 'aws-lambda';
import { STSClient, AssumeRoleWithWebIdentityCommand, Credentials } from '@aws-sdk/client-sts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { getTenantId } from './tenantUtils';

// Cache for tenant credentials
interface CachedCredentials {
  credentials: Credentials;
  expiresAt: number;
}

const credentialsCache = new Map<string, CachedCredentials>();

// Generic cache for AWS service clients
const clientCaches = {
  dynamodb: new Map<string, DynamoDBClient>(),
  s3: new Map<string, S3Client>(),
  sqs: new Map<string, SQSClient>(),
  sns: new Map<string, SNSClient>(),
  lambda: new Map<string, LambdaClient>(),
};

/**
 * Get tenant-specific credentials using AssumeRoleWithWebIdentity
 */
async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {
  const tenantId = getTenantId(event);
  
  // Check cache first
  const cached = credentialsCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.credentials;
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

    // Cache credentials with 5 minute buffer before expiration
    const expiresAt = Credentials.Expiration ? 
      Credentials.Expiration.getTime() - 5 * 60 * 1000 : 
      Date.now() + 55 * 60 * 1000;

    credentialsCache.set(tenantId, {
      credentials: Credentials,
      expiresAt,
    });

    return Credentials;
  } catch (error) {
    console.error('AssumeRoleWithWebIdentity failed:', error);
    throw new Error(`Failed to get tenant credentials: ${error}`);
  }
}

/**
 * Create a tenant-specific DynamoDB client
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCaches.dynamodb.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create DynamoDB client with tenant credentials
  const client = new DynamoDBClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCaches.dynamodb.set(tenantId, client);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCaches.dynamodb.delete(tenantId), ttl);

  return client;
}

/**
 * Create a tenant-specific S3 client
 */
export async function createTenantS3Client(
  event: APIGatewayProxyEvent
): Promise<S3Client> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCaches.s3.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create S3 client with tenant credentials
  const client = new S3Client({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCaches.s3.set(tenantId, client);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCaches.s3.delete(tenantId), ttl);

  return client;
}

/**
 * Create a tenant-specific SQS client
 */
export async function createTenantSQSClient(
  event: APIGatewayProxyEvent
): Promise<SQSClient> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCaches.sqs.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create SQS client with tenant credentials
  const client = new SQSClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCaches.sqs.set(tenantId, client);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCaches.sqs.delete(tenantId), ttl);

  return client;
}

/**
 * Create a tenant-specific SNS client
 */
export async function createTenantSNSClient(
  event: APIGatewayProxyEvent
): Promise<SNSClient> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCaches.sns.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create SNS client with tenant credentials
  const client = new SNSClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCaches.sns.set(tenantId, client);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCaches.sns.delete(tenantId), ttl);

  return client;
}

/**
 * Create a tenant-specific Lambda client
 */
export async function createTenantLambdaClient(
  event: APIGatewayProxyEvent
): Promise<LambdaClient> {
  const tenantId = getTenantId(event);
  
  // Return cached client if available
  const cachedClient = clientCaches.lambda.get(tenantId);
  if (cachedClient) {
    return cachedClient;
  }

  const credentials = await getTenantCredentials(event);

  // Create Lambda client with tenant credentials
  const client = new LambdaClient({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });

  // Cache client
  clientCaches.lambda.set(tenantId, client);
  
  // Clear cache before credentials expire
  const ttl = credentials.Expiration ? 
    credentials.Expiration.getTime() - Date.now() - 5 * 60 * 1000 : 
    55 * 60 * 1000;
  
  setTimeout(() => clientCaches.lambda.delete(tenantId), ttl);

  return client;
}

/**
 * Get tenant-specific resource name
 * @param baseResourceName Base name of the resource
 * @param event API Gateway event containing tenant information
 * @returns Tenant-specific resource name
 */
export function getTenantResourceName(
  baseResourceName: string,
  event: APIGatewayProxyEvent
): string {
  const tenantId = getTenantId(event);
  return `${baseResourceName}-tenant-${tenantId}`;
}

/**
 * Clear all cached clients and credentials for a tenant
 * Useful for testing or when tenant access needs to be revoked
 */
export function clearTenantCache(tenantId: string): void {
  credentialsCache.delete(tenantId);
  clientCaches.dynamodb.delete(tenantId);
  clientCaches.s3.delete(tenantId);
  clientCaches.sqs.delete(tenantId);
  clientCaches.sns.delete(tenantId);
  clientCaches.lambda.delete(tenantId);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  credentialsCache.clear();
  clientCaches.dynamodb.clear();
  clientCaches.s3.clear();
  clientCaches.sqs.clear();
  clientCaches.sns.clear();
  clientCaches.lambda.clear();
}