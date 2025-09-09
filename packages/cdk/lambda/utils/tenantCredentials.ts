import { APIGatewayProxyEvent } from 'aws-lambda';
import { Credentials } from '@aws-sdk/client-sts';
import {
  assumeRoleWithWebIdentity,
  buildTenantRoleArn,
  extractTenantId,
} from './assumeRoleWithWebIdentity';
import { getTenant } from '../tenantManager';

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
 * Get tenant role ARN with cross-account support
 * Checks tenant metadata for cross-account role, falls back to same-account role
 */
async function getTenantRoleArn(tenantId: string, fallbackAccountId: string): Promise<string> {
  try {
    // Try to get tenant metadata from DynamoDB
    const tenant = await getTenant(tenantId);
    
    // If tenant has cross-account role ARN, use it
    if (tenant && tenant.crossAccountRoleArn) {
      console.log(`Using cross-account role ARN for tenant ${tenantId}: ${tenant.crossAccountRoleArn}`);
      return tenant.crossAccountRoleArn;
    }
    
    // Fall back to same-account role ARN for backward compatibility
    const fallbackRoleArn = buildTenantRoleArn(fallbackAccountId, tenantId);
    console.log(`Using same-account role ARN for tenant ${tenantId}: ${fallbackRoleArn}`);
    return fallbackRoleArn;
  } catch (error) {
    console.warn(`Failed to get tenant metadata for ${tenantId}, falling back to same-account role:`, error);
    // Fall back to same-account role ARN if tenant lookup fails
    const fallbackRoleArn = buildTenantRoleArn(fallbackAccountId, tenantId);
    console.log(`Using fallback same-account role ARN for tenant ${tenantId}: ${fallbackRoleArn}`);
    return fallbackRoleArn;
  }
}

/**
 * Get tenant credentials using AssumeRoleWithWebIdentity
 * Supports both cross-account and same-account roles with automatic fallback
 * NOTE: No caching to ensure proper user isolation within tenants
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {
  // Validate environment variables
  const { region, accountId } = validateEnvironment();

  // Extract tenant ID from JWT claims
  const tenantId = extractTenantId(event);

  // Extract user ID for logging
  const userId =
    event.requestContext?.authorizer?.claims?.['cognito:username'] || 'unknown';

  console.log(
    `Getting tenant credentials for tenant: ${tenantId}, user: ${userId} using AssumeRoleWithWebIdentity`
  );

  try {
    // Get role ARN from tenant metadata or fallback to same-account
    const roleArn = await getTenantRoleArn(tenantId, accountId);

    console.log(`Assuming role: ${roleArn}`);

    // Use AssumeRoleWithWebIdentity to get tenant credentials
    const credentials = await assumeRoleWithWebIdentity(event, roleArn);

    console.log(
      `Successfully obtained tenant credentials for tenant: ${tenantId}, user: ${userId}`
    );

    return credentials;
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

    throw new Error(`Failed to get tenant credentials: ${(error as Error).message}`);
  }
}
