import { APIGatewayProxyEvent } from 'aws-lambda';
import { Credentials } from '@aws-sdk/client-sts';
import {
  assumeRoleWithWebIdentity,
  extractTenantId,
} from './assumeRoleWithWebIdentity';
import { getTenant, Tenant } from '../tenantManager';
import { getUsername } from './tenantUtils';

// === キャッシュ関連の定義 ===

interface CachedCredentials {
  credentials: Credentials;
  tenant: Tenant;
  expiresAt: number; // Unix timestamp (ms)
}

const credentialsCache = new Map<string, CachedCredentials>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // 5分のバッファ

function getCacheKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

function getFromCache(cacheKey: string): CachedCredentials | null {
  const cached = credentialsCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Date.now() >= cached.expiresAt) {
    credentialsCache.delete(cacheKey);
    console.log(`Cache expired for key: ${cacheKey}`);
    return null;
  }
  return cached;
}

function saveToCache(
  cacheKey: string,
  credentials: Credentials,
  tenant: Tenant
): void {
  const expiresAt = credentials.Expiration
    ? new Date(credentials.Expiration).getTime() - CACHE_BUFFER_MS
    : Date.now() + 55 * 60 * 1000;

  credentialsCache.set(cacheKey, {
    credentials,
    tenant,
    expiresAt,
  });

  console.log(
    `Cached credentials for key: ${cacheKey}, expires at: ${new Date(expiresAt).toISOString()}`
  );
}

// Interface for returning both credentials and tenant info
export interface TenantCredentialsWithInfo {
  credentials: Credentials;
  tenant: Tenant;
}

// Environment validation helper
const validateEnvironment = () => {
  if (!process.env.AWS_REGION) {
    throw new Error('AWS_REGION environment variable is not set');
  }
  if (!process.env.AWS_ACCOUNT_ID) {
    throw new Error('AWS_ACCOUNT_ID environment variable is not set');
  }
  return {
    region: process.env.AWS_REGION,
    accountId: process.env.AWS_ACCOUNT_ID,
  };
};

/**
 * Get tenant credentials using AssumeRoleWithWebIdentity
 * Supports both cross-account and same-account roles with automatic fallback
 * Credentials are cached per tenant+user to reduce Cognito API calls
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<TenantCredentialsWithInfo> {
  // Validate environment variables
  const { region, accountId } = validateEnvironment();

  // Extract tenant ID from JWT claims
  const tenantId = extractTenantId(event);

  // Extract user ID for logging
  const userId = getUsername(event);

  // === キャッシュチェック ===
  const cacheKey = getCacheKey(tenantId, userId);
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(
      `Using cached credentials for tenant: ${tenantId}, user: ${userId}`
    );
    return {
      credentials: cached.credentials,
      tenant: cached.tenant,
    };
  }

  console.log(
    `Getting tenant credentials for tenant: ${tenantId}, user: ${userId} using AssumeRoleWithWebIdentity`
  );

  try {
    // Get tenant metadata - required for cross-account access
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found in tenants table`);
    }

    // Check if tenant has role ARN configured
    if (!tenant.roleArn) {
      throw new Error(`Tenant ${tenantId} is missing roleArn configuration`);
    }

    console.log(`Assuming role for tenant ${tenantId}: ${tenant.roleArn}`);

    // Use AssumeRoleWithWebIdentity to get tenant credentials
    const credentials = await assumeRoleWithWebIdentity(event, tenant.roleArn);

    // === キャッシュに保存 ===
    saveToCache(cacheKey, credentials, tenant);

    console.log(
      `Successfully obtained tenant credentials for tenant: ${tenantId}, user: ${userId}`
    );

    return {
      credentials,
      tenant,
    };
  } catch (error) {
    console.error(
      `Failed to get tenant credentials for tenant: ${tenantId}, user: ${userId}:`,
      {
        error: error,
        errorMessage: (error as Error).message,
        accountId,
        region,
      }
    );

    throw new Error(
      `Failed to get tenant credentials: ${(error as Error).message}`
    );
  }
}
