/**
 * E2E Test Environment Setup
 *
 * Loads configuration from .env.e2e and fetches remaining values from CloudFormation.
 * Exports all required environment variables for E2E tests.
 *
 * .env.e2e only needs:
 *   - E2E_ENV_NAME (optional): Environment prefix for stack name
 *   - AWS_PROFILE (optional): AWS profile to use
 *   - AWS_REGION (optional): AWS region
 *   - E2E_TENANT_ID: Tenant ID
 *
 * The script auto-fetches from CloudFormation:
 *   - E2E_API_BASE_URL
 *   - E2E_COGNITO_USER_POOL_ID
 *   - E2E_COGNITO_CLIENT_ID
 *
 * Note: Admin user is automatically created by TestUserManager during tests
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const ENV_FILE = path.join(__dirname, '..', '.env.e2e');
const DEFAULT_REGION = 'ap-northeast-1';
const BASE_STACK_NAME = 'GenerativeAiUseCasesStack';

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let input = '';
      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.removeListener('data', onData);
          rl.close();
          console.log();
          resolve(input);
        } else if (char === '\u0003') {
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

function loadEnvFile(): Record<string, string> {
  const config: Record<string, string> = {};

  if (!fs.existsSync(ENV_FILE)) {
    console.log('No .env.e2e found, using environment variables only');
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

async function getCloudFormationOutputs(
  stackName: string,
  region: string
): Promise<Record<string, string>> {
  const client = new CloudFormationClient({ region });
  const command = new DescribeStacksCommand({ StackName: stackName });

  try {
    const response = await client.send(command);
    const outputs: Record<string, string> = {};

    response.Stacks?.[0]?.Outputs?.forEach((output: { OutputKey?: string; OutputValue?: string }) => {
      if (output.OutputKey && output.OutputValue) {
        outputs[output.OutputKey] = output.OutputValue;
      }
    });

    return outputs;
  } catch (error: any) {
    if (error.name === 'ValidationError' || error.message?.includes('does not exist')) {
      console.error(`Stack '${stackName}' not found`);
    } else {
      console.error(`Error fetching stack outputs: ${error.message}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('=== E2E Environment Setup ===\n');

  // Load .env.e2e file
  const envConfig = loadEnvFile();

  // Merge with process.env (process.env takes precedence)
  const getEnv = (key: string): string => process.env[key] || envConfig[key] || '';

  // Set AWS_PROFILE if specified
  const awsProfile = getEnv('AWS_PROFILE');
  if (awsProfile) {
    process.env.AWS_PROFILE = awsProfile;
    console.log(`AWS Profile: ${awsProfile}`);
  }

  // Determine region and stack name
  const region = getEnv('AWS_REGION') || DEFAULT_REGION;
  const envName = getEnv('E2E_ENV_NAME');
  const stackName = envName ? `${BASE_STACK_NAME}${envName}` : BASE_STACK_NAME;

  console.log(`Region: ${region}`);
  console.log(`Stack: ${stackName}`);
  console.log('');

  // Fetch CloudFormation outputs
  console.log('Fetching CloudFormation outputs...');
  const outputs = await getCloudFormationOutputs(stackName, region);

  const apiEndpoint = outputs['BillingApiEndpoint']?.replace(/\/$/, '');
  const userPoolId = outputs['UserPoolId'];
  const clientId = outputs['UserPoolClientId'];

  if (!apiEndpoint || !userPoolId || !clientId) {
    console.error('\nError: Missing required CloudFormation outputs');
    console.error('Required: BillingApiEndpoint, UserPoolId, UserPoolClientId');
    console.error('\nAvailable outputs:', Object.keys(outputs).join(', ') || 'none');
    process.exit(1);
  }

  console.log(`  API: ${apiEndpoint}`);
  console.log(`  UserPool: ${userPoolId}`);
  console.log(`  ClientId: ${clientId}`);
  console.log('');

  // Get tenant ID (from env/file or prompt)
  let tenantId = getEnv('E2E_TENANT_ID');

  if (!tenantId) {
    tenantId = await prompt('Tenant ID: ');
  }

  if (!tenantId) {
    console.error('\nError: Missing required configuration');
    console.error('Please set E2E_TENANT_ID in .env.e2e');
    process.exit(1);
  }

  // Export all environment variables
  process.env.E2E_API_BASE_URL = apiEndpoint;
  process.env.E2E_COGNITO_USER_POOL_ID = userPoolId;
  process.env.E2E_COGNITO_CLIENT_ID = clientId;
  process.env.E2E_TENANT_ID = tenantId;
  process.env.AWS_REGION = region;

  console.log('Environment configured successfully\n');
}

main().catch((error) => {
  console.error('\nSetup failed:', error.message || error);
  process.exit(1);
});
