import { APIGatewayProxyEvent } from 'aws-lambda';
import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { getTenant } from '../tenantManager';
import { extractTenantId } from './assumeRoleWithWebIdentity';

// Cache for authorization results (short TTL)
const authCache = new Map<
  string,
  { result: boolean; timestamp: number; ttl: number }
>();
const DEFAULT_CACHE_TTL = 60000; // 1 minute

// OpenFGA API request/response types
interface OpenFgaCheckRequest {
  tuple_key: {
    user: string;
    relation: string;
    object: string;
  };
  contextual_tuples?: {
    tuple_keys: Array<{
      user: string;
      relation: string;
      object: string;
    }>;
  };
}

interface OpenFgaCheckResponse {
  allowed: boolean;
}

/**
 * OpenFGA client for authorization checks
 */
export class OpenFgaClient {
  private tenantId: string;
  private apiEndpoint: string;
  private apiRegion: string;
  private credentials: Credentials;
  private storeId: string;

  constructor(
    tenantId: string,
    apiEndpoint: string,
    apiRegion: string,
    credentials: Credentials,
    storeId: string
  ) {
    this.tenantId = tenantId;
    this.apiEndpoint = apiEndpoint;
    this.apiRegion = apiRegion;
    this.credentials = credentials;
    this.storeId = storeId;
  }

  /**
   * Check if a user has permission to access a resource
   */
  async check(
    userId: string,
    relation: string,
    objectType: string,
    objectId: string
  ): Promise<boolean> {
    const cacheKey = `${this.tenantId}:${userId}:${relation}:${objectType}:${objectId}`;
    const cached = authCache.get(cacheKey);

    // Check cache
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      console.log(`Authorization check cache hit: ${cacheKey}`);
      return cached.result;
    }

    try {
      const requestBody: OpenFgaCheckRequest = {
        tuple_key: {
          user: `user:${userId}`,
          relation: relation,
          object: `${objectType}:${objectId}`,
        },
      };

      // Make signed request to OpenFGA API
      const response = await this.makeSignedRequest(
        'POST',
        `/stores/${this.storeId}/check`,
        JSON.stringify(requestBody)
      );

      const result: OpenFgaCheckResponse = JSON.parse(response);

      // Cache the result
      authCache.set(cacheKey, {
        result: result.allowed,
        timestamp: Date.now(),
        ttl: DEFAULT_CACHE_TTL,
      });

      console.log(
        `Authorization check for ${userId} -> ${objectType}:${objectId} (${relation}): ${result.allowed}`
      );

      return result.allowed;
    } catch (error) {
      console.error('OpenFGA authorization check failed:', error);
      // Fail closed - deny access on error
      return false;
    }
  }

  /**
   * Make a signed request to OpenFGA API Gateway
   */
  private async makeSignedRequest(
    method: string,
    path: string,
    body?: string
  ): Promise<string> {
    const url = new URL(this.apiEndpoint);
    const hostname = url.hostname;
    const protocol = url.protocol.replace(':', '');

    // Create HTTP request
    const request = new HttpRequest({
      method,
      protocol,
      hostname,
      path: `${url.pathname}${path}`.replace(/\/\//g, '/'),
      headers: {
        'Content-Type': 'application/json',
        host: hostname,
      },
      body,
    });

    // Sign the request with SigV4
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: this.credentials.AccessKeyId!,
        secretAccessKey: this.credentials.SecretAccessKey!,
        sessionToken: this.credentials.SessionToken,
      },
      region: this.apiRegion,
      service: 'execute-api',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);

    // Make the HTTP request
    const response = await fetch(
      `${protocol}://${hostname}${signedRequest.path}`,
      {
        method: signedRequest.method,
        headers: signedRequest.headers as HeadersInit,
        body: signedRequest.body,
      }
    );

    if (!response.ok) {
      throw new Error(
        `OpenFGA API request failed: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  }
}

/**
 * Create an OpenFGA client for the current tenant
 */
export async function createOpenFgaClient(
  event: APIGatewayProxyEvent,
  credentials: Credentials
): Promise<OpenFgaClient | null> {
  try {
    const tenantId = extractTenantId(event);
    const tenant = await getTenant(tenantId);

    if (!tenant) {
      console.error(`Tenant ${tenantId} not found`);
      return null;
    }

    if (!tenant.openFgaApiEndpoint || !tenant.openFgaApiRegion || !tenant.openFgaStoreId) {
      console.warn(
        `Tenant ${tenantId} does not have OpenFGA configured. Skipping authorization.`
      );
      return null;
    }

    return new OpenFgaClient(
      tenantId,
      tenant.openFgaApiEndpoint,
      tenant.openFgaApiRegion || tenant.region,
      credentials,
      tenant.openFgaStoreId
    );
  } catch (error) {
    console.error('Failed to create OpenFGA client:', error);
    return null;
  }
}

/**
 * Check if a user has permission to use a specific LLM model
 */
export async function checkLlmAccess(
  openFgaClient: OpenFgaClient | null,
  userId: string,
  modelId: string
): Promise<boolean> {
  if (!openFgaClient) {
    // If OpenFGA is not configured, allow access by default (backward compatibility)
    console.warn(
      'OpenFGA client not available. Allowing access by default for backward compatibility.'
    );
    return true;
  }

  return await openFgaClient.check(userId, 'accessor', 'llm', modelId);
}

/**
 * Check if a user has permission to use a specific feature
 */
export async function checkFeatureAccess(
  openFgaClient: OpenFgaClient | null,
  userId: string,
  featureName: string
): Promise<boolean> {
  if (!openFgaClient) {
    // If OpenFGA is not configured, allow access by default (backward compatibility)
    console.warn(
      'OpenFGA client not available. Allowing access by default for backward compatibility.'
    );
    return true;
  }

  return await openFgaClient.check(userId, 'enabled_user', 'feature', featureName);
}

/**
 * Clear authorization cache (useful for testing or when permissions change)
 */
export function clearAuthCache(): void {
  authCache.clear();
  console.log('Authorization cache cleared');
}
