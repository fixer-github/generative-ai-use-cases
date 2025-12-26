/**
 * E2E Global Teardown
 *
 * This runs ONCE after all test files have completed.
 * Cleans up all test data:
 * - Deletes all test users from Cognito (email prefix: e2e-test)
 * - Deprecates all test plans via API (internal_name prefix: [E2E-TEST])
 *
 * NOTE: This file must NOT import from files that use vitest
 * because globalSetup/globalTeardown run in a different context.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
  AuthFlowType,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';

const CDK_ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(CDK_ROOT, '.env.e2e');
const DEFAULT_REGION = 'ap-northeast-1';
const BASE_STACK_NAME = 'GenerativeAiUseCasesStack';

// Test data prefixes (duplicated from testDataFactory to avoid vitest import chain)
const E2E_TEST_EMAIL_PREFIX = 'e2e-test';
const E2E_TEST_PREFIX = '[E2E-TEST]';

function loadEnvFile(): Record<string, string> {
  const config: Record<string, string> = {};

  if (!fs.existsSync(ENV_FILE)) {
    return config;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (value) {
        config[key] = value;
      }
    }
  });

  return config;
}

function getCredentialProvider(): AwsCredentialIdentityProvider | undefined {
  if (process.env.AWS_PROFILE) {
    return fromIni({ profile: process.env.AWS_PROFILE });
  }
  return undefined;
}

async function getCloudFormationOutputs(
  stackName: string,
  region: string
): Promise<Record<string, string>> {
  const credentials = getCredentialProvider();
  const client = new CloudFormationClient({
    region,
    ...(credentials && { credentials }),
  });
  const command = new DescribeStacksCommand({ StackName: stackName });

  const response = await client.send(command);
  const outputs: Record<string, string> = {};

  response.Stacks?.[0]?.Outputs?.forEach(
    (output: { OutputKey?: string; OutputValue?: string }) => {
      if (output.OutputKey && output.OutputValue) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    }
  );

  return outputs;
}

/**
 * Simple API client for teardown (standalone, no vitest imports)
 */
class TeardownApiClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
  }

  async get<T>(path: string): Promise<{ status: number; data: T }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: this.authToken,
        'Content-Type': 'application/json',
      },
    });
    const data = (await response.json()) as T;
    return { status: response.status, data };
  }

  async patch<T>(
    path: string,
    body: unknown
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        Authorization: this.authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as T;
    return { status: response.status, data };
  }
}

/**
 * Delete all test users from Cognito
 */
async function deleteAllTestUsers(
  userPoolId: string,
  region: string
): Promise<{ deleted: number; failed: number }> {
  const credentials = getCredentialProvider();
  const client = new CognitoIdentityProviderClient({
    region,
    ...(credentials && { credentials }),
  });

  // List all test users
  const users: string[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
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

  if (users.length === 0) {
    console.log('No test users found to clean up.');
    return { deleted: 0, failed: 0 };
  }

  console.log(`Found ${users.length} test users to clean up...`);

  let deleted = 0;
  let failed = 0;

  for (const username of users) {
    try {
      await client.send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: username,
        })
      );
      deleted++;
      console.log(`  Deleted user: ${username}`);
    } catch (error: any) {
      if (error.name !== 'UserNotFoundException') {
        console.warn(`  Failed to delete user ${username}:`, error.message);
        failed++;
      }
    }
  }

  console.log(`User cleanup complete: ${deleted} deleted, ${failed} failed`);
  return { deleted, failed };
}

/**
 * Create a temporary admin user for cleanup operations
 */
async function createCleanupAdminUser(
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

/**
 * Delete a user from Cognito
 */
async function deleteUser(
  userPoolId: string,
  username: string,
  region: string
): Promise<void> {
  const credentials = getCredentialProvider();
  const client = new CognitoIdentityProviderClient({
    region,
    ...(credentials && { credentials }),
  });

  try {
    await client.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      })
    );
  } catch (error: any) {
    if (error.name !== 'UserNotFoundException') {
      console.warn(`Failed to delete user ${username}:`, error.message);
    }
  }
}

/**
 * Deprecate all test plans via API
 */
async function deprecateAllTestPlans(
  apiClient: TeardownApiClient
): Promise<{ deprecated: number; failed: number; skipped: number }> {
  // List all plans
  let plans: Array<{ plan_id: string; internal_name: string; status: string }> =
    [];

  try {
    const response = await apiClient.get<{
      plans: Array<{
        plan_id: string;
        internal_name: string;
        status: string;
      }>;
    }>('/admin/billing/plans');

    if (response.status === 200 && response.data.plans) {
      // Filter plans by E2E test prefix
      plans = response.data.plans.filter((plan) =>
        plan.internal_name.startsWith(E2E_TEST_PREFIX)
      );
    }
  } catch (error) {
    console.warn('Error listing plans:', error);
    return { deprecated: 0, failed: 0, skipped: 0 };
  }

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

    try {
      // First close to new subscriptions
      await apiClient.patch(`/admin/billing/plans/${plan.plan_id}/status`, {
        new_status: 'closed_to_new',
      });

      // Then deprecate
      const response = await apiClient.patch(
        `/admin/billing/plans/${plan.plan_id}/status`,
        { new_status: 'deprecated' }
      );

      if (response.status === 200) {
        deprecated++;
        console.log(
          `  Deprecated plan: ${plan.internal_name} (${plan.plan_id})`
        );
      } else {
        // Plan might already be deprecated
        deprecated++;
      }
    } catch (error) {
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

export default async function globalTeardown() {
  console.log('\n========================================');
  console.log('Global Teardown: Cleaning up test data...');
  console.log('========================================\n');

  try {
    // Load environment configuration
    const envConfig = loadEnvFile();
    const region =
      envConfig.AWS_REGION || process.env.AWS_REGION || DEFAULT_REGION;
    const envName = envConfig.E2E_ENV_NAME || process.env.E2E_ENV_NAME || '';
    const tenantId = envConfig.E2E_TENANT_ID || process.env.E2E_TENANT_ID || '';
    const stackName = envName
      ? `${BASE_STACK_NAME}${envName}`
      : BASE_STACK_NAME;

    // Set AWS_PROFILE if configured
    if (envConfig.AWS_PROFILE && !process.env.AWS_PROFILE) {
      process.env.AWS_PROFILE = envConfig.AWS_PROFILE;
    }

    // Get configuration from environment or CloudFormation
    let apiBaseUrl =
      envConfig.E2E_API_BASE_URL || process.env.E2E_API_BASE_URL || '';
    let cognitoUserPoolId =
      envConfig.E2E_COGNITO_USER_POOL_ID ||
      process.env.E2E_COGNITO_USER_POOL_ID ||
      '';
    let cognitoClientId =
      envConfig.E2E_COGNITO_CLIENT_ID ||
      process.env.E2E_COGNITO_CLIENT_ID ||
      '';

    // Fetch from CloudFormation if needed
    if (!apiBaseUrl || !cognitoUserPoolId || !cognitoClientId) {
      console.log(
        `Fetching configuration from CloudFormation stack: ${stackName}`
      );
      try {
        const outputs = await getCloudFormationOutputs(stackName, region);
        if (!apiBaseUrl) {
          apiBaseUrl = outputs['BillingApiEndpoint']?.replace(/\/$/, '') || '';
        }
        if (!cognitoUserPoolId) {
          cognitoUserPoolId = outputs['UserPoolId'] || '';
        }
        if (!cognitoClientId) {
          cognitoClientId = outputs['UserPoolClientId'] || '';
        }
      } catch (error) {
        console.error('Failed to fetch CloudFormation outputs:', error);
        console.warn('Skipping cleanup due to configuration error.');
        return;
      }
    }

    // Validate configuration
    if (!cognitoUserPoolId || !cognitoClientId || !tenantId) {
      console.warn('Missing required configuration for cleanup. Skipping.');
      return;
    }

    // === Step 1: Clean up test users from Cognito ===
    console.log('\n--- Cleaning up test users from Cognito ---');
    await deleteAllTestUsers(cognitoUserPoolId, region);

    // === Step 2: Clean up test plans via API ===
    if (apiBaseUrl) {
      console.log('\n--- Cleaning up test plans via API ---');

      // Create a temporary admin user for API access
      let cleanupUsername: string | undefined;
      try {
        console.log('Creating temporary admin user for plan cleanup...');
        const { token, username } = await createCleanupAdminUser(
          cognitoUserPoolId,
          cognitoClientId,
          tenantId,
          region
        );
        cleanupUsername = username;

        const apiClient = new TeardownApiClient(apiBaseUrl, token);
        await deprecateAllTestPlans(apiClient);
      } catch (error) {
        console.error('Failed to clean up plans:', error);
      } finally {
        // Delete the cleanup user
        if (cleanupUsername) {
          console.log('Deleting temporary cleanup user...');
          await deleteUser(cognitoUserPoolId, cleanupUsername, region);
        }
      }
    } else {
      console.warn('API Base URL not configured. Skipping plan cleanup.');
    }

    console.log('\n========================================');
    console.log('Global Teardown: Complete');
    console.log('========================================\n');
  } catch (error) {
    console.error('Global Teardown Error:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }
}
