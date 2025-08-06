import { APIGatewayProxyEvent } from 'aws-lambda';
import { STSClient, AssumeRoleWithWebIdentityCommand, Credentials } from '@aws-sdk/client-sts';

// Cache for credentials per tenant
const credentialsCache = new Map<string, { credentials: Credentials; expiry: number }>();

// Maximum retries for STS AssumeRole
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // milliseconds

/**
 * Get credentials using AssumeRoleWithWebIdentity with retry logic
 * The assumed role's IAM policies automatically enforce tenant isolation
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {
  // Extract tenant ID for cache key
  const tenantId = event.requestContext?.authorizer?.claims?.['custom:tenant_id'] || 'default';
  const cacheKey = tenantId;
  
  // Check cache and validate expiration
  const cached = credentialsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    // Check if credentials will expire soon (within 1 minute)
    if (cached.expiry - Date.now() < 60000) {
      console.warn('Cached credentials expiring soon, will refresh');
    } else {
      return cached.credentials;
    }
  }

  // Extract JWT token from Authorization header
  const authHeader = event.headers.Authorization || event.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization token found');
  }
  
  const idToken = authHeader.substring(7);
  
  // Ensure session name doesn't exceed 64 character limit
  const sessionName = `session-${tenantId}-${Date.now()}`.substring(0, 64);

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Assume role with web identity
      // The JWT's tenant ID claim is automatically passed as a session tag
      const stsClient = new STSClient({});
      const { Credentials } = await stsClient.send(
        new AssumeRoleWithWebIdentityCommand({
          RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
          RoleSessionName: sessionName,
          WebIdentityToken: idToken,
          DurationSeconds: 3600,
        })
      );

      if (!Credentials) {
        throw new Error('Failed to obtain credentials from STS response');
      }

      // Cache credentials with 5 minute buffer before expiration
      const expiry = Credentials.Expiration ? 
        Credentials.Expiration.getTime() - 5 * 60 * 1000 : 
        Date.now() + 55 * 60 * 1000;
      
      credentialsCache.set(cacheKey, {
        credentials: Credentials,
        expiry: expiry
      });
      
      // Clean up old cache entries
      for (const [key, value] of credentialsCache.entries()) {
        if (Date.now() > value.expiry) {
          credentialsCache.delete(key);
        }
      }

      return Credentials;
    } catch (error) {
      lastError = error as Error;
      console.error(`AssumeRoleWithWebIdentity attempt ${attempt} failed:`, error);
      
      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
      }
    }
  }
  
  // All retries failed
  throw new Error(`Failed to get credentials after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}