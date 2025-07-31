#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from '../lib/stacks/tenant/tenant-dynamodb-stack';

/**
 * Script to provision DynamoDB tables for a new tenant
 * 
 * Usage:
 *   npm run provision-tenant -- --tenant-id <tenant-id> [--region <region>] [--profile <profile>]
 * 
 * Examples:
 *   npm run provision-tenant -- --tenant-id acme-corp
 *   npm run provision-tenant -- --tenant-id acme-corp --region us-west-2
 *   npm run provision-tenant -- --tenant-id acme-corp --profile production
 */

interface ProvisionTenantArgs {
  tenantId: string;
  region?: string;
  profile?: string;
  stackName?: string;
}

function parseArgs(): ProvisionTenantArgs {
  const args = process.argv.slice(2);
  const result: Partial<ProvisionTenantArgs> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--tenant-id':
        result.tenantId = args[++i];
        break;
      case '--region':
        result.region = args[++i];
        break;
      case '--profile':
        result.profile = args[++i];
        break;
      case '--stack-name':
        result.stackName = args[++i];
        break;
    }
  }

  if (!result.tenantId) {
    console.error('Error: --tenant-id is required');
    console.error('Usage: npm run provision-tenant -- --tenant-id <tenant-id> [--region <region>] [--profile <profile>]');
    process.exit(1);
  }

  return result as ProvisionTenantArgs;
}

async function main() {
  const args = parseArgs();
  
  console.log(`Provisioning DynamoDB tables for tenant: ${args.tenantId}`);
  
  const app = new cdk.App();
  
  // Generate stack name if not provided
  const stackName = args.stackName || `TenantDynamoDB-${args.tenantId}`;
  
  // Create the stack
  new TenantDynamoDBStack(app, stackName, {
    tenantId: args.tenantId,
    description: `DynamoDB tables for tenant ${args.tenantId}`,
    env: {
      region: args.region || process.env.CDK_DEFAULT_REGION,
      account: process.env.CDK_DEFAULT_ACCOUNT,
    },
  });

  // Synthesize
  app.synth();
  
  console.log(`Stack ${stackName} synthesized successfully`);
  console.log(`To deploy, run: cdk deploy ${stackName}${args.profile ? ` --profile ${args.profile}` : ''}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});