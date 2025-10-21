/**
 * OpenFGA Client Utility for Hybrid ToC/ToB Authorization
 *
 * This module provides a comprehensive client for interacting with OpenFGA
 * using the hybrid ToC (To Consumer) and ToB (To Business) schema.
 *
 * Features:
 * - Capability-based permission checks (usecase, model, resource)
 * - Entitlement management (grant, revoke, block)
 * - Quota management (tenant pool + individual user limits)
 * - Plan subscription management (user and tenant)
 * - Batch operations for efficiency
 * - Caching support
 */

import { OpenFgaClient, CheckRequest, WriteRequest, TupleKey } from '@openfga/sdk';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Environment variables
const OPENFGA_API_URL = process.env.OPENFGA_API_URL!;
const OPENFGA_STORE_ID = process.env.OPENFGA_STORE_ID!;
const OPENFGA_KEY_SECRET_ARN = process.env.OPENFGA_KEY_SECRET_ARN!;

// Singleton client
let clientInstance: OpenFgaClient | null = null;
let cachedApiKey: string | null = null;
const secretsClient = new SecretsManagerClient({});

/**
 * Get or create OpenFGA client instance
 */
export async function getOpenFGAClient(): Promise<OpenFgaClient> {
  if (clientInstance && cachedApiKey) {
    return clientInstance;
  }

  // Fetch API key from Secrets Manager
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: OPENFGA_KEY_SECRET_ARN })
  );

  cachedApiKey = JSON.parse(secretResponse.SecretString!).key;

  clientInstance = new OpenFgaClient({
    apiUrl: OPENFGA_API_URL,
    storeId: OPENFGA_STORE_ID,
    credentials: {
      method: 'api_token',
      config: {
        token: cachedApiKey,
      },
    },
  });

  return clientInstance;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Quota context for permission checks
 */
export interface QuotaContext {
  userCurrentUsage: number;
  userQuotaLimit: number;
  tenantCurrentUsage?: number;
  tenantQuotaLimit?: number;
}

/**
 * Check if user can execute a usecase
 */
export async function checkUsecasePermission(
  userId: string,
  usecaseId: string
): Promise<PermissionCheckResult> {
  const client = await getOpenFGAClient();

  try {
    const response = await client.check({
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `usecase_capability:${usecaseId}`,
    });

    return {
      allowed: response.allowed || false,
      reason: response.allowed ? undefined : 'permission_denied',
    };
  } catch (error) {
    console.error('Usecase permission check error:', error);
    return {
      allowed: false,
      reason: 'check_error',
    };
  }
}

/**
 * Check if user can execute a model (with quota)
 */
export async function checkModelPermission(
  userId: string,
  modelId: string,
  quotaContext?: QuotaContext
): Promise<PermissionCheckResult> {
  const client = await getOpenFGAClient();

  try {
    const checkRequest: CheckRequest = {
      user: `user:${userId}`,
      relation: 'can_execute',
      object: `model_capability:${modelId}`,
    };

    // Add quota context if provided
    if (quotaContext) {
      checkRequest.context = {
        user_current_usage: quotaContext.userCurrentUsage,
        user_quota_limit: quotaContext.userQuotaLimit,
        ...(quotaContext.tenantCurrentUsage !== undefined && {
          tenant_current_usage: quotaContext.tenantCurrentUsage,
        }),
        ...(quotaContext.tenantQuotaLimit !== undefined && {
          tenant_quota_limit: quotaContext.tenantQuotaLimit,
        }),
      };

      // Pre-check quota before calling OpenFGA
      if (quotaContext.userCurrentUsage >= quotaContext.userQuotaLimit) {
        return {
          allowed: false,
          reason: 'user_quota_exceeded',
        };
      }

      if (
        quotaContext.tenantCurrentUsage !== undefined &&
        quotaContext.tenantQuotaLimit !== undefined &&
        quotaContext.tenantCurrentUsage >= quotaContext.tenantQuotaLimit
      ) {
        return {
          allowed: false,
          reason: 'tenant_quota_exceeded',
        };
      }
    }

    const response = await client.check(checkRequest);

    return {
      allowed: response.allowed || false,
      reason: response.allowed ? undefined : 'permission_denied',
    };
  } catch (error) {
    console.error('Model permission check error:', error);
    return {
      allowed: false,
      reason: 'check_error',
    };
  }
}

/**
 * Check resource permission (conversation, document)
 */
export async function checkResourcePermission(
  userId: string,
  resourceType: 'conversation' | 'document',
  resourceId: string,
  permission: 'view' | 'edit' | 'delete' | 'upload'
): Promise<PermissionCheckResult> {
  const client = await getOpenFGAClient();

  try {
    const response = await client.check({
      user: `user:${userId}`,
      relation: permission,
      object: `${resourceType}:${resourceId}`,
    });

    return {
      allowed: response.allowed || false,
      reason: response.allowed ? undefined : 'permission_denied',
    };
  } catch (error) {
    console.error('Resource permission check error:', error);
    return {
      allowed: false,
      reason: 'check_error',
    };
  }
}

/**
 * Grant entitlement to user via plan subscription (ToC)
 */
export async function grantUserPlanSubscription(
  userId: string,
  planId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'user_subscriber',
          object: `plan:${planId}`,
        },
      ],
    },
  });
}

/**
 * Revoke user plan subscription (ToC)
 */
export async function revokeUserPlanSubscription(
  userId: string,
  planId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'user_subscriber',
          object: `plan:${planId}`,
        },
      ],
    },
  });
}

/**
 * Grant tenant plan subscription (ToB)
 */
export async function grantTenantPlanSubscription(
  tenantId: string,
  planId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant_subscriber',
          object: `plan:${planId}`,
        },
        {
          user: `plan:${planId}`,
          relation: 'plan_subscription',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Revoke tenant plan subscription (ToB)
 */
export async function revokeTenantPlanSubscription(
  tenantId: string,
  planId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant_subscriber',
          object: `plan:${planId}`,
        },
        {
          user: `plan:${planId}`,
          relation: 'plan_subscription',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Grant specific entitlement to user by tenant admin (ToB)
 *
 * IMPORTANT: The entitlement-to-capability mapping (e.g., entitlement:usecase_chat
 * -> usecase_capability:chat) must be provisioned separately during system setup.
 * This function only creates the tenant-specific assignment.
 *
 * @param entitlementId - Pre-existing entitlement ID (e.g., "usecase_chat")
 */
export async function grantTenantEntitlement(
  tenantId: string,
  userId: string,
  entitlementId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const tenantEntitlementId = `tenant_entitlement:${tenantId}/${userId}/${entitlementId}`;

  await client.write({
    writes: {
      tuple_keys: [
        // Create tenant entitlement
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: tenantEntitlementId,
        },
        {
          user: `user:${userId}`,
          relation: 'grantee',
          object: tenantEntitlementId,
        },
        // Link entitlement to tenant assignment
        {
          user: tenantEntitlementId,
          relation: 'via_tenant_assignment',
          object: `entitlement:${entitlementId}`,
        },
        // NOTE: entitlement -> capability link must already exist (provisioned separately)
      ],
    },
  });
}

/**
 * Revoke tenant entitlement from user (ToB)
 */
export async function revokeTenantEntitlement(
  tenantId: string,
  userId: string,
  entitlementId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const tenantEntitlementId = `tenant_entitlement:${tenantId}/${userId}/${entitlementId}`;

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: tenantEntitlementId,
        },
        {
          user: `user:${userId}`,
          relation: 'grantee',
          object: tenantEntitlementId,
        },
        {
          user: tenantEntitlementId,
          relation: 'via_tenant_assignment',
          object: `entitlement:${entitlementId}`,
        },
      ],
    },
  });
}

/**
 * Block user from capability (explicit deny by tenant admin)
 */
export async function blockUserFromCapability(
  tenantId: string,
  userId: string,
  capabilityType: 'usecase' | 'model',
  capabilityId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const blockId = `tenant_entitlement:${tenantId}/${userId}/${capabilityId}_block`;

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: blockId,
        },
        {
          user: `user:${userId}`,
          relation: 'blocked',
          object: blockId,
        },
        {
          user: blockId,
          relation: 'blocked_by_tenant',
          object: `${capabilityType}_capability:${capabilityId}`,
        },
      ],
    },
  });
}

/**
 * Unblock user from capability
 */
export async function unblockUserFromCapability(
  tenantId: string,
  userId: string,
  capabilityType: 'usecase' | 'model',
  capabilityId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const blockId = `tenant_entitlement:${tenantId}/${userId}/${capabilityId}_block`;

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: blockId,
        },
        {
          user: `user:${userId}`,
          relation: 'blocked',
          object: blockId,
        },
        {
          user: blockId,
          relation: 'blocked_by_tenant',
          object: `${capabilityType}_capability:${capabilityId}`,
        },
      ],
    },
  });
}

/**
 * Grant tenant membership
 */
export async function grantTenantMembership(
  userId: string,
  tenantId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'member',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Revoke tenant membership
 */
export async function revokeTenantMembership(
  userId: string,
  tenantId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'member',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Grant tenant admin role
 */
export async function grantTenantAdmin(
  userId: string,
  tenantId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'admin',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Revoke tenant admin role
 */
export async function revokeTenantAdmin(
  userId: string,
  tenantId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'admin',
          object: `tenant:${tenantId}`,
        },
      ],
    },
  });
}

/**
 * Set individual quota grant for user
 *
 * NOTE: This function only creates the OpenFGA tuples. The quotaLimit must be
 * stored separately in DynamoDB (DYNAMODB_USER_QUOTA_TABLE) so it can be
 * retrieved during permission checks.
 */
export async function setUserQuotaGrant(
  userId: string,
  tenantId: string,
  modelId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const quotaGrantId = `quota_grant:${tenantId}/${userId}/${modelId}`;

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'user',
          object: quotaGrantId,
        },
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: quotaGrantId,
        },
        {
          user: `model_capability:${modelId}`,
          relation: 'model',
          object: quotaGrantId,
        },
        // CRITICAL: Link quota_grant back to model_capability
        // This enables "holder from quota_grant" in the schema
        {
          user: quotaGrantId,
          relation: 'quota_grant',
          object: `model_capability:${modelId}`,
        },
      ],
    },
  });
}

/**
 * Remove user quota grant
 */
export async function removeUserQuotaGrant(
  userId: string,
  tenantId: string,
  modelId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const quotaGrantId = `quota_grant:${tenantId}/${userId}/${modelId}`;

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'user',
          object: quotaGrantId,
        },
        {
          user: `tenant:${tenantId}`,
          relation: 'tenant',
          object: quotaGrantId,
        },
        {
          user: `model_capability:${modelId}`,
          relation: 'model',
          object: quotaGrantId,
        },
        // Remove the link from quota_grant to model_capability
        {
          user: quotaGrantId,
          relation: 'quota_grant',
          object: `model_capability:${modelId}`,
        },
      ],
    },
  });
}

/**
 * Set resource ownership
 */
export async function setResourceOwner(
  userId: string,
  resourceType: 'conversation' | 'document',
  resourceId: string,
  tenantId?: string
): Promise<void> {
  const client = await getOpenFGAClient();

  const writes: TupleKey[] = [
    {
      user: `user:${userId}`,
      relation: 'owner',
      object: `${resourceType}:${resourceId}`,
    },
  ];

  // Optional tenant association
  if (tenantId) {
    writes.push({
      user: `tenant:${tenantId}`,
      relation: 'tenant',
      object: `${resourceType}:${resourceId}`,
    });
  }

  await client.write({ writes: { tuple_keys: writes } });
}

/**
 * Share resource with user
 */
export async function shareResource(
  userId: string,
  resourceType: 'conversation' | 'document',
  resourceId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    writes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'viewer',
          object: `${resourceType}:${resourceId}`,
        },
      ],
    },
  });
}

/**
 * Unshare resource with user
 */
export async function unshareResource(
  userId: string,
  resourceType: 'conversation' | 'document',
  resourceId: string
): Promise<void> {
  const client = await getOpenFGAClient();

  await client.write({
    deletes: {
      tuple_keys: [
        {
          user: `user:${userId}`,
          relation: 'viewer',
          object: `${resourceType}:${resourceId}`,
        },
      ],
    },
  });
}

/**
 * List user's effective permissions (debugging utility)
 */
export async function listUserPermissions(
  userId: string,
  capabilityType: 'usecase' | 'model'
): Promise<string[]> {
  const client = await getOpenFGAClient();

  try {
    const response = await client.listObjects({
      user: `user:${userId}`,
      relation: 'can_execute',
      type: `${capabilityType}_capability`,
    });

    return response.objects || [];
  } catch (error) {
    console.error('List permissions error:', error);
    return [];
  }
}

/**
 * Batch permission checks
 */
export async function checkBatchPermissions(
  checks: Array<{
    userId: string;
    resourceType: string;
    resourceId: string;
    permission: string;
  }>
): Promise<Map<string, boolean>> {
  const client = await getOpenFGAClient();
  const results = new Map<string, boolean>();

  // OpenFGA doesn't have native batch check, so we do parallel checks
  const checkPromises = checks.map(async (check) => {
    const key = `${check.userId}:${check.resourceType}:${check.resourceId}:${check.permission}`;
    try {
      const response = await client.check({
        user: `user:${check.userId}`,
        relation: check.permission,
        object: `${check.resourceType}:${check.resourceId}`,
      });
      results.set(key, response.allowed || false);
    } catch (error) {
      console.error(`Batch check error for ${key}:`, error);
      results.set(key, false);
    }
  });

  await Promise.all(checkPromises);
  return results;
}
