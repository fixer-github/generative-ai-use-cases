import { APIGatewayProxyEvent } from 'aws-lambda';
import { STSClient, AssumeRoleWithWebIdentityCommand, Credentials } from '@aws-sdk/client-sts';
import { getTenantId } from './tenantUtils';

// Cache for tenant credentials
interface CachedCredentials {
  credentials: Credentials;
  expiresAt: number;
}

const credentialsCache = new Map<string, CachedCredentials>();

/**
 * Get tenant-specific credentials using AssumeRoleWithWebIdentity
 * This can be used by any service-specific client implementation
 */
export async function getTenantCredentials(
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
 * Clear cached credentials for a tenant
 */
export function clearTenantCredentials(tenantId: string): void {
  credentialsCache.delete(tenantId);
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