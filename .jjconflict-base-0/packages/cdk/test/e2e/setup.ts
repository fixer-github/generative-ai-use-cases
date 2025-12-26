/**
 * E2E Test Setup
 *
 * This file runs before each test file and fetches CloudFormation outputs.
 * AWS credentials are already configured by globalSetup.ts.
 *
 * Required in .env.e2e:
 *   - E2E_ENV_NAME: Environment name (e.g., "Dev", "Staging")
 *   - E2E_TENANT_ID: Tenant ID for multi-tenant testing
 *   - AWS_PROFILE (optional): AWS profile to use
 *   - AWS_REGION (optional): AWS region (defaults to ap-northeast-1)
 *
 * Auto-fetched from CloudFormation:
 *   - E2E_API_BASE_URL (from BillingApiEndpoint output)
 *   - E2E_COGNITO_USER_POOL_ID (from UserPoolId output)
 *   - E2E_COGNITO_CLIENT_ID (from UserPoolClientId output)
 */

import { beforeAll, afterAll } from 'vitest';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';

const DEFAULT_REGION = 'ap-northeast-1';
const BASE_STACK_NAME = 'GenerativeAiUseCasesStack';

/**
 * Fetch outputs from CloudFormation stack
 */
async function getCloudFormationOutputs(
  stackName: string,
  region: string
): Promise<Record<string, string>> {
  const client = new CloudFormationClient({ region });
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

// Mutable config that will be populated in beforeAll
export let testConfig = {
  apiBaseUrl: '',
  cognitoUserPoolId: '',
  cognitoClientId: '',
  tenantId: '',
};

beforeAll(async () => {
  const region = process.env.AWS_REGION || DEFAULT_REGION;
  const envName = process.env.E2E_ENV_NAME || '';
  const stackName = envName ? `${BASE_STACK_NAME}${envName}` : BASE_STACK_NAME;

  // Get values from environment (set by globalSetup)
  let apiBaseUrl = process.env.E2E_API_BASE_URL || '';
  let cognitoUserPoolId = process.env.E2E_COGNITO_USER_POOL_ID || '';
  let cognitoClientId = process.env.E2E_COGNITO_CLIENT_ID || '';
  const tenantId = process.env.E2E_TENANT_ID || '';

  // Fetch from CloudFormation if any required values are missing
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
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch CloudFormation outputs: ${errorMessage}`);
      throw new Error(
        `Cannot fetch CloudFormation outputs from stack '${stackName}'. ` +
          'Please ensure the stack exists and you have proper AWS credentials configured.'
      );
    }
  }

  // Set environment variables for other modules
  process.env.E2E_API_BASE_URL = apiBaseUrl;
  process.env.E2E_COGNITO_USER_POOL_ID = cognitoUserPoolId;
  process.env.E2E_COGNITO_CLIENT_ID = cognitoClientId;
  process.env.E2E_TENANT_ID = tenantId;

  // Update testConfig
  testConfig = {
    apiBaseUrl,
    cognitoUserPoolId,
    cognitoClientId,
    tenantId,
  };

  // Validate required configuration
  const missingConfig: string[] = [];
  if (!testConfig.apiBaseUrl) missingConfig.push('E2E_API_BASE_URL');
  if (!testConfig.cognitoUserPoolId)
    missingConfig.push('E2E_COGNITO_USER_POOL_ID');
  if (!testConfig.cognitoClientId) missingConfig.push('E2E_COGNITO_CLIENT_ID');
  if (!testConfig.tenantId) missingConfig.push('E2E_TENANT_ID');

  if (missingConfig.length > 0) {
    throw new Error(
      `Missing required E2E configuration: ${missingConfig.join(', ')}. ` +
        'Please set E2E_ENV_NAME and E2E_TENANT_ID in .env.e2e file.'
    );
  }

  console.log('E2E Test Configuration:');
  console.log(`  Stack: ${stackName}`);
  console.log(`  API Base URL: ${testConfig.apiBaseUrl}`);
  console.log(`  Cognito User Pool ID: ${testConfig.cognitoUserPoolId}`);
  console.log(`  Cognito Client ID: ${testConfig.cognitoClientId}`);
  console.log(`  Tenant ID: ${testConfig.tenantId}`);
});

afterAll(() => {
  // Global cleanup if needed
});
