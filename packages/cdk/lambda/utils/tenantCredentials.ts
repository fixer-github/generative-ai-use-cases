import { APIGatewayProxyEvent } from 'aws-lambda';
import { Credentials } from '@aws-sdk/client-sts';
import {
  assumeRoleWithWebIdentity,
  extractTenantId,
} from './assumeRoleWithWebIdentity';
import { getTenant, Tenant } from '../tenantManager';
import { getUsername } from './tenantUtils';
import { verifyToken } from './auth';

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
 * NOTE: No caching to ensure proper user isolation within tenants
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

    const userId =
      event.requestContext?.authorizer?.claims?.['cognito:username'];
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
