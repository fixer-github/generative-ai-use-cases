import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Credentials } from '@aws-sdk/client-sts';

/**
 * Cache for SSM parameters
 * Structure: Map<cacheKey, { value: string, timestamp: number, ttl: number }>
 *
 * Following the in-memory cache pattern from openFgaClient.ts
 * TTL is longer than auth cache (5min vs 5sec) since SSM parameters change infrequently
 */
const ssmParameterCache = new Map<
  string,
  { value: string; timestamp: number; ttl: number }
>();

// Default cache TTL: 5 minutes (300,000ms)
// SSM parameters change infrequently, so longer cache is appropriate
const DEFAULT_CACHE_TTL = 300000;

/**
 * OpenFGA configuration retrieved from SSM Parameter Store
 */
export interface OpenFgaConfig {
  apiEndpoint: string;
  apiRegion: string;
  storeId: string;
}

/**
 * RDS configuration retrieved from SSM Parameter Store
 */
export interface RdsConfig {
  endpoint: string;
  port: number;
  database: string;
  region: string;
  username: string;
}

/**
 * Get a parameter from SSM Parameter Store with tenant credentials
 * Uses in-memory caching to reduce SSM API calls
 *
 * @param parameterName - SSM parameter name (e.g., `/genu-gaixer/tenants/${tenantId}/openFgaApiEndpoint`)
 * @param credentials - Tenant-specific AWS credentials from AssumeRole
 * @param region - AWS region where SSM parameter is stored
 * @param ttl - Cache TTL in milliseconds (default: 5 minutes)
 * @returns Parameter value
 */
async function getParameter(
  parameterName: string,
  credentials: Credentials,
  region: string,
  ttl: number = DEFAULT_CACHE_TTL
): Promise<string> {
  // Create cache key using parameter name and credentials
  // Include session token to handle credential rotation
  const cacheKey = `${parameterName}:${credentials.AccessKeyId}:${credentials.SessionToken}`;

  // Check cache
  const cached = ssmParameterCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    console.log(`SSM parameter cache hit: ${parameterName}`);
    return cached.value;
  }

  try {
    // Create SSM client with tenant credentials
    const ssmClient = new SSMClient({
      region,
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken,
      },
    });

    // Get parameter from SSM
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    );

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} has no value`);
    }

    const value = response.Parameter.Value;

    // Cache the result
    ssmParameterCache.set(cacheKey, {
      value,
      timestamp: Date.now(),
      ttl,
    });

    console.log(`Retrieved SSM parameter: ${parameterName}`);
    return value;
  } catch (error) {
    console.error(`Failed to get SSM parameter ${parameterName}:`, error);
    throw new Error(
      `Failed to get SSM parameter ${parameterName}: ${(error as Error).message}`
    );
  }
}

/**
 * Get OpenFGA configuration from SSM Parameter Store for a specific tenant
 * Retrieves all three parameters needed for OpenFGA client initialization
 *
 * @param tenantId - Tenant identifier
 * @param credentials - Tenant-specific AWS credentials from AssumeRole
 * @param region - AWS region where SSM parameters are stored
 * @returns OpenFGA configuration object
 */
export async function getOpenFgaConfig(
  tenantId: string,
  credentials: Credentials,
  region: string
): Promise<OpenFgaConfig> {
  console.log(`Getting OpenFGA config from SSM for tenant: ${tenantId}`);

  try {
    // Retrieve all three parameters in parallel for better performance
    const [apiEndpoint, apiRegion, storeId] = await Promise.all([
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/openFgaApiEndpoint`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/openFgaApiRegion`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/openFgaStoreId`,
        credentials,
        region
      ),
    ]);

    console.log(
      `Successfully retrieved OpenFGA config from SSM for tenant: ${tenantId}`
    );

    return {
      apiEndpoint,
      apiRegion,
      storeId,
    };
  } catch (error) {
    console.error(
      `Failed to get OpenFGA config from SSM for tenant ${tenantId}:`,
      error
    );
    throw new Error(
      `Failed to get OpenFGA config from SSM: ${(error as Error).message}`
    );
  }
}

/**
 * Get RDS configuration from SSM Parameter Store for a specific tenant
 * Retrieves all RDS parameters needed for database connection
 *
 * @param tenantId - Tenant identifier
 * @param credentials - Tenant-specific AWS credentials from AssumeRole
 * @param region - AWS region where SSM parameters are stored
 * @returns RDS configuration object
 */
export async function getRdsConfig(
  tenantId: string,
  credentials: Credentials,
  region: string
): Promise<RdsConfig> {
  console.log(`Getting RDS config from SSM for tenant: ${tenantId}`);

  try {
    // Retrieve all RDS parameters in parallel for better performance
    const [endpoint, port, database, rdsRegion, username] = await Promise.all([
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/rdsEndpoint`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/rdsPort`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/rdsDatabase`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/rdsRegion`,
        credentials,
        region
      ),
      getParameter(
        `/genu-gaixer/tenants/${tenantId}/rdsUsername`,
        credentials,
        region
      ),
    ]);

    console.log(
      `Successfully retrieved RDS config from SSM for tenant: ${tenantId}`
    );

    return {
      endpoint,
      port: parseInt(port, 10),
      database,
      region: rdsRegion,
      username,
    };
  } catch (error) {
    console.error(
      `Failed to get RDS config from SSM for tenant ${tenantId}:`,
      error
    );
    throw new Error(
      `Failed to get RDS config from SSM: ${(error as Error).message}`
    );
  }
}

/**
 * Clear SSM parameter cache (useful for testing or when parameters change)
 */
export function clearSsmParameterCache(): void {
  ssmParameterCache.clear();
  console.log('SSM parameter cache cleared');
}
