/**
 * Global Cleanup Helper for E2E Tests
 *
 * Provides cleanup functions that run after all tests complete.
 * - Deletes all test users from Cognito (by email prefix)
 * - Deprecates all test plans via API (by internal_name prefix)
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
  AuthFlowType,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { E2E_TEST_EMAIL_PREFIX, E2E_TEST_PREFIX } from './testDataFactory';
import { ApiClient } from './apiClient';

/**
 * Get credential provider based on AWS_PROFILE
 */
function getCredentialProvider(): AwsCredentialIdentityProvider | undefined {
  if (process.env.AWS_PROFILE) {
    return fromIni({ profile: process.env.AWS_PROFILE });
  }
  return undefined;
}

/**
 * Global cleanup helper for test users
 */
export class GlobalUserCleanup {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;

  constructor(userPoolId: string, region: string) {
    const credentials = getCredentialProvider();
    this.client = new CognitoIdentityProviderClient({
      region,
      ...(credentials && { credentials }),
    });
    this.userPoolId = userPoolId;
  }

  /**
   * List all test users by email prefix
   */
  async listTestUsers(): Promise<string[]> {
    const users: string[] = [];
    let paginationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListUsersCommand({
          UserPoolId: this.userPoolId,
          Filter: `email ^= "${E2E_TEST_EMAIL_PREFIX}"`,
          Limit: 60,
          PaginationToken: paginationToken,
        })
      );

      for (const user of response.Users || []) {
        if (user.Username) {
          users.push(user.Username);
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return users;
  }

  /**
   * Delete a user from Cognito
   */
  async deleteUser(username: string): Promise<boolean> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        })
      );
      return true;
    } catch (error: any) {
      if (error.name !== 'UserNotFoundException') {
        console.warn(`Failed to delete user ${username}:`, error.message);
      }
      return false;
    }
  }

  /**
   * Delete all test users
   */
  async deleteAllTestUsers(): Promise<{ deleted: number; failed: number }> {
    const users = await this.listTestUsers();

    if (users.length === 0) {
      console.log('No test users found to clean up.');
      return { deleted: 0, failed: 0 };
    }

    console.log(`Found ${users.length} test users to clean up...`);

    let deleted = 0;
    let failed = 0;

    for (const username of users) {
      if (await this.deleteUser(username)) {
        deleted++;
        console.log(`  Deleted user: ${username}`);
      } else {
        failed++;
      }
    }

    console.log(`User cleanup complete: ${deleted} deleted, ${failed} failed`);
    return { deleted, failed };
  }
}

/**
 * Global cleanup helper for test plans
 */
export class GlobalPlanCleanup {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * List all test plans by prefix
   */
  async listTestPlans(): Promise<
    Array<{ plan_id: string; internal_name: string; status: string }>
  > {
    try {
      const response = await this.apiClient.get<{
        plans: Array<{
          plan_id: string;
          internal_name: string;
          status: string;
        }>;
      }>('/admin/billing/plans');

      if (response.status !== 200 || !response.data.plans) {
        console.warn('Failed to list plans:', response.status);
        return [];
      }

      // Filter plans by E2E test prefix
      return response.data.plans.filter((plan) =>
        plan.internal_name.startsWith(E2E_TEST_PREFIX)
      );
    } catch (error) {
      console.warn('Error listing plans:', error);
      return [];
    }
  }

  /**
   * Deprecate a plan (two-step process: active -> closed_to_new -> deprecated)
   */
  async deprecatePlan(planId: string): Promise<boolean> {
    try {
      // First close to new subscriptions
      await this.apiClient.patch(`/admin/billing/plans/${planId}/status`, {
        new_status: 'closed_to_new',
      });

      // Then deprecate
      const response = await this.apiClient.patch(
        `/admin/billing/plans/${planId}/status`,
        { new_status: 'deprecated' }
      );

      return response.status === 200;
    } catch (error) {
      // Plan might already be deprecated
      return true;
    }
  }

  /**
   * Deprecate all test plans
   */
  async deprecateAllTestPlans(): Promise<{
    deprecated: number;
    failed: number;
    skipped: number;
  }> {
    const plans = await this.listTestPlans();

    if (plans.length === 0) {
      console.log('No test plans found to clean up.');
      return { deprecated: 0, failed: 0, skipped: 0 };
    }

    console.log(`Found ${plans.length} test plans to clean up...`);

    let deprecated = 0;
    let failed = 0;
    let skipped = 0;

    for (const plan of plans) {
      if (plan.status === 'deprecated') {
        skipped++;
        continue;
      }

      if (await this.deprecatePlan(plan.plan_id)) {
        deprecated++;
        console.log(
          `  Deprecated plan: ${plan.internal_name} (${plan.plan_id})`
        );
      } else {
        failed++;
        console.warn(
          `  Failed to deprecate plan: ${plan.internal_name} (${plan.plan_id})`
        );
      }
    }

    console.log(
      `Plan cleanup complete: ${deprecated} deprecated, ${skipped} already deprecated, ${failed} failed`
    );
    return { deprecated, failed, skipped };
  }
}

/**
 * Create a temporary admin user for cleanup operations
 */
export async function createCleanupAdminUser(
  userPoolId: string,
  clientId: string,
  tenantId: string,
  region: string
): Promise<{ token: string; username: string }> {
  const credentials = getCredentialProvider();
  const client = new CognitoIdentityProviderClient({
    region,
    ...(credentials && { credentials }),
  });

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const username = `${E2E_TEST_EMAIL_PREFIX}-cleanup-${timestamp}-${random}@example.com`;
  const password = 'Cleanup1!Temp' + random;

  // Create user
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributes: [
        { Name: 'email', Value: username },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: tenantId },
        { Name: 'custom:tenantAdmin', Value: 'true' },
      ],
      TemporaryPassword: password,
      MessageAction: MessageActionType.SUPPRESS,
    })
  );

  // Set permanent password
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    })
  );

  // Get token
  const authResponse = await client.send(
    new InitiateAuthCommand({
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: clientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    })
  );

  if (!authResponse.AuthenticationResult?.IdToken) {
    throw new Error('Failed to get authentication token for cleanup user');
  }

  return {
    token: authResponse.AuthenticationResult.IdToken,
    username,
  };
}
