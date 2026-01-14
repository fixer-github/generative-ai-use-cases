import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  Credentials,
  STSClient,
  AssumeRoleCommand,
} from '@aws-sdk/client-sts';
import {
  assumeRoleWithWebIdentity,
  extractTenantId,
} from './assumeRoleWithWebIdentity';
import { getTenant, Tenant } from '../tenantManager';
import { getUsername } from './tenantUtils';
import { verifyToken } from './auth';

/**
 * === テナント認証情報キャッシュ ===
 *
 * Lambdaのウォームスタート時にメモリ上に保持される認証情報キャッシュ。
 * Cold Start時はキャッシュは空で、認証情報取得後に保存される。
 *
 * キャッシュは以下のAPI呼び出しを削減する:
 * - Cognito Identity Pool (GetId, GetOpenIdToken)
 * - STS (AssumeRoleWithWebIdentity)
 * - DynamoDB (テナント情報取得)
 *
 * セキュリティ:
 * - テナントID+ユーザーID単位でキャッシュを分離
 * - ユーザーIDが不明な場合はキャッシュをバイパス
 * - LRU方式でキャッシュサイズを制限
 */

interface CachedCredentials {
  readonly credentials: Credentials;
  readonly tenant: Tenant;
  readonly expiresAt: number; // Unix timestamp (ms)
}

const credentialsCache = new Map<string, CachedCredentials>();
const CACHE_BUFFER_MS = 5 * 60 * 1000; // 5分のバッファ
const DEFAULT_CACHE_TTL_MS = 55 * 60 * 1000; // デフォルトTTL: 55分（STSデフォルト1時間 - 5分バッファ）
const MAX_CACHE_SIZE = 100; // LRU方式で制限

/**
 * テナントIDとユーザーIDからキャッシュキーを生成
 *
 * ユーザーID単位でキャッシュを分離することで、
 * 同一テナント内でも異なるユーザーの認証情報が混在しないようにする。
 * これにより、ユーザー固有のIAMロール権限が正しく適用される。
 */
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
    console.log(`Cache expired for tenant`);
    return null;
  }
  return { ...cached };
}

/**
 * LRU方式でキャッシュサイズを制限
 * Map.keys()は挿入順でイテレートするため、最も古いエントリを削除
 */
function evictOldestIfNeeded(): void {
  if (credentialsCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = credentialsCache.keys().next().value;
    if (oldestKey) {
      credentialsCache.delete(oldestKey);
      console.log(`Evicted oldest cache entry due to size limit`);
    }
  }
}

function saveToCache(
  cacheKey: string,
  credentials: Credentials,
  tenant: Tenant
): void {
  evictOldestIfNeeded();

  const expiresAt = credentials.Expiration
    ? new Date(credentials.Expiration).getTime() - CACHE_BUFFER_MS
    : Date.now() + DEFAULT_CACHE_TTL_MS;

  credentialsCache.set(cacheKey, {
    credentials,
    tenant,
    expiresAt,
  });

  console.log(
    `Cached credentials for tenant, expires at: ${new Date(expiresAt).toISOString()}`
  );
}

// Interface for returning both credentials and tenant info
export interface TenantCredentialsWithInfo {
  credentials: Credentials;
  tenant: Tenant;
  region: string;
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
 * Credentials are cached per tenant+user to reduce API calls
 * (Cognito Identity Pool, STS, DynamoDB)
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<TenantCredentialsWithInfo> {
  // Validate environment variables
  const { region, accountId } = validateEnvironment();

  // Extract tenant ID from JWT claims
  const tenantId = extractTenantId(event);

  // Extract user ID for cache isolation
  const userId = getUsername(event);

  // === セキュリティチェック: ユーザーIDが不明な場合はキャッシュをバイパス ===
  const shouldUseCache = userId !== 'unknown';

  if (!shouldUseCache) {
    console.warn(
      `[SECURITY] No user ID found for tenant: ${tenantId}. Skipping cache.`
    );
  }

  // === キャッシュチェック ===
  if (shouldUseCache) {
    const cacheKey = getCacheKey(tenantId, userId);
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`Using cached credentials for tenant: ${tenantId}`);
      return {
        credentials: cached.credentials,
        tenant: cached.tenant,
        region: cached.tenant.region || region,
      };
    }
  }

  console.log(
    `Getting tenant credentials for tenant: ${tenantId} using AssumeRoleWithWebIdentity`
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

    const userPoolToken = event.headers.Authorization;
    if (!userPoolToken) {
      throw new Error('No valid authorization token found');
    }
    const credentials = await assumeRoleWithWebIdentity(
      userPoolToken,
      tenantId,
      userId,
      tenant.roleArn
    );

    // === キャッシュに保存（ユーザーIDが有効な場合のみ）===
    if (shouldUseCache) {
      const cacheKey = getCacheKey(tenantId, userId);
      saveToCache(cacheKey, credentials, tenant);
    }

    console.log(`Successfully obtained tenant credentials for tenant: ${tenantId}`);

    return {
      credentials,
      tenant,
      region,
    };
  } catch (error) {
    console.error(`Failed to get tenant credentials for tenant: ${tenantId}:`, {
      error: error,
      errorMessage: (error as Error).message,
      accountId,
      region,
    });

    throw new Error(
      `Failed to get tenant credentials: ${(error as Error).message}`
    );
  }
}

/**
 * Get tenant credentials from ID token (for use with PredictStream and similar functions)
 * Verifies the JWT token and extracts tenant information, then assumes the appropriate role
 *
 * @param idToken - Cognito User Pool ID token (JWT)
 * @returns Object containing tenant credentials and tenant metadata
 */
export async function getTenantCredentialsFromToken(
  idToken: string
): Promise<TenantCredentialsWithInfo> {
  // Validate environment variables
  const { region, accountId } = validateEnvironment();

  // Verify and decode the JWT token
  const payload = await verifyToken(idToken);
  if (!payload) {
    throw new Error('Invalid or expired ID token');
  }

  // Extract tenant ID and user ID from token claims
  const tenantId = payload['custom:tenant_id'];
  const userId = payload['cognito:username'];

  if (!tenantId) {
    throw new Error('Tenant ID not found in ID token claims');
  }
  if (!userId) {
    throw new Error('User ID not found in ID token claims');
  }

  console.log(
    `Getting tenant credentials from token for tenant: ${tenantId}, user: ${userId} using AssumeRoleWithWebIdentity`
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

    // Use AssumeRoleWithIdToken to get tenant credentials
    const credentials = await assumeRoleWithWebIdentity(
      idToken,
      tenantId,
      userId,
      tenant.roleArn
    );

    console.log(
      `Successfully obtained tenant credentials for tenant: ${tenantId}, user: ${userId}`
    );

    return {
      credentials,
      tenant,
      region,
    };
  } catch (error) {
    console.error(
      `Failed to get tenant credentials from token for tenant: ${tenantId}, user: ${userId}:`,
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

/**
 * === 内部Lambda呼び出し用キャッシュ ===
 *
 * Lambda-to-Lambda内部呼び出し用のクレデンシャルキャッシュ。
 * ユーザーコンテキストがないため、テナントID単位でキャッシュ。
 */
const internalCredentialsCache = new Map<string, CachedCredentials>();

function getInternalCacheKey(tenantId: string): string {
  return `internal:${tenantId}`;
}

function getFromInternalCache(tenantId: string): CachedCredentials | null {
  const cacheKey = getInternalCacheKey(tenantId);
  const cached = internalCredentialsCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Date.now() >= cached.expiresAt) {
    internalCredentialsCache.delete(cacheKey);
    console.log(`Internal cache expired for tenant: ${tenantId}`);
    return null;
  }
  return { ...cached };
}

function saveToInternalCache(
  tenantId: string,
  credentials: Credentials,
  tenant: Tenant
): void {
  // LRU eviction
  if (internalCredentialsCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = internalCredentialsCache.keys().next().value;
    if (oldestKey) {
      internalCredentialsCache.delete(oldestKey);
      console.log(`Evicted oldest internal cache entry due to size limit`);
    }
  }

  const expiresAt = credentials.Expiration
    ? new Date(credentials.Expiration).getTime() - CACHE_BUFFER_MS
    : Date.now() + DEFAULT_CACHE_TTL_MS;

  internalCredentialsCache.set(getInternalCacheKey(tenantId), {
    credentials,
    tenant,
    expiresAt,
  });

  console.log(
    `Cached internal credentials for tenant: ${tenantId}, expires at: ${new Date(expiresAt).toISOString()}`
  );
}

/**
 * 内部Lambda-to-Lambda呼び出し用のテナントクレデンシャル取得
 *
 * API Gateway経由ではない内部呼び出し（Lambda-to-Lambda）で使用。
 * ユーザーコンテキスト（JWT）がないため、直接STSのAssumeRoleを使用。
 *
 * クロスアカウント呼び出しの場合のみクレデンシャルを返し、
 * 同一アカウントの場合はnullを返す（Lambda実行ロールを使用すべき）。
 *
 * @param tenantId テナントID
 * @returns クロスアカウントの場合はクレデンシャル、同一アカウントの場合はnull
 */
export async function getTenantCredentialsForInternalCall(
  tenantId: string
): Promise<TenantCredentialsWithInfo | null> {
  // Validate environment variables
  const { region, accountId } = validateEnvironment();

  // Get tenant metadata
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found in tenants table`);
  }

  // Check if cross-account
  const isCrossAccount = tenant.accountId !== accountId;
  if (!isCrossAccount) {
    console.log(
      `Same account detected for tenant: ${tenantId}. Using Lambda execution role.`
    );
    return null;
  }

  // Check cache
  const cached = getFromInternalCache(tenantId);
  if (cached) {
    console.log(`Using cached internal credentials for tenant: ${tenantId}`);
    return {
      credentials: cached.credentials,
      tenant: cached.tenant,
      region: tenant.region || region,
    };
  }

  // Check if tenant has role ARN configured
  if (!tenant.roleArn) {
    throw new Error(`Tenant ${tenantId} is missing roleArn configuration`);
  }

  console.log(
    `Cross-account invocation for tenant: ${tenantId}. Assuming role: ${tenant.roleArn}`
  );

  try {
    const stsClient = new STSClient({
      region: region,
    });

    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: tenant.roleArn,
      RoleSessionName: `internal-${tenantId}-${Date.now()}`,
      DurationSeconds: 900, // 15 minutes
    });

    const response = await stsClient.send(assumeRoleCommand);

    if (!response.Credentials) {
      throw new Error(`Failed to assume role for tenant: ${tenantId}`);
    }

    const credentials: Credentials = {
      AccessKeyId: response.Credentials.AccessKeyId!,
      SecretAccessKey: response.Credentials.SecretAccessKey!,
      SessionToken: response.Credentials.SessionToken!,
      Expiration: response.Credentials.Expiration,
    };

    // Save to cache
    saveToInternalCache(tenantId, credentials, tenant);

    console.log(
      `Successfully assumed role for tenant: ${tenantId} (cross-account)`
    );

    return {
      credentials,
      tenant,
      region: tenant.region || region,
    };
  } catch (error) {
    console.error(
      `Failed to assume role for tenant: ${tenantId}:`,
      (error as Error).message
    );
    throw new Error(
      `Failed to get internal tenant credentials: ${(error as Error).message}`
    );
  }
}

/**
 * Get tenant credentials for batch processing (without JWT token)
 * Uses direct STS AssumeRole instead of AssumeRoleWithWebIdentity
 *
 * This is designed for background jobs like summary generation where
 * there is no user JWT token available.
 */
export async function getTenantCredentialsForBatch(
  tenantId: string
): Promise<TenantCredentialsWithInfo> {
  const { region } = validateEnvironment();

  // Check cache first (using a batch-specific key)
  const cacheKey = `batch:${tenantId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`Using cached batch credentials for tenant: ${tenantId}`);
    return {
      credentials: cached.credentials,
      tenant: cached.tenant,
      region: cached.tenant.region || region,
    };
  }

  console.log(`Getting batch credentials for tenant: ${tenantId} using AssumeRole`);

  try {
    // Get tenant metadata
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found in tenants table`);
    }

    if (!tenant.roleArn) {
      throw new Error(`Tenant ${tenantId} is missing roleArn configuration`);
    }

    console.log(`Assuming role for batch tenant ${tenantId}: ${tenant.roleArn}`);

    // Use direct STS AssumeRole (not AssumeRoleWithWebIdentity)
    const stsClient = new STSClient({ region });

    const assumeRoleResponse = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: tenant.roleArn,
        RoleSessionName: `batch-summary-${tenantId}-${Date.now()}`,
        DurationSeconds: 3600, // 1 hour
      })
    );

    if (!assumeRoleResponse.Credentials) {
      throw new Error('No credentials returned from AssumeRole');
    }

    const credentials: Credentials = {
      AccessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
      SecretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
      SessionToken: assumeRoleResponse.Credentials.SessionToken,
      Expiration: assumeRoleResponse.Credentials.Expiration,
    };

    // Save to cache
    saveToCache(cacheKey, credentials, tenant);

    console.log(`Successfully obtained batch credentials for tenant: ${tenantId}`);

    return {
      credentials,
      tenant,
      region: tenant.region || region,
    };
  } catch (error) {
    console.error(`Failed to get batch credentials for tenant: ${tenantId}:`, error);
    throw new Error(`Failed to get batch credentials: ${(error as Error).message}`);
  }
}
