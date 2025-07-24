#!/usr/bin/env node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TENANT_CONFIG_FILE = path.join(__dirname, '../tenant-config.json');

interface TenantConfig {
  tenants: {
    [tenantId: string]: {
      name: string;
      createdAt: string;
      stackName: string;
    };
  };
}

function loadTenantConfig(): TenantConfig {
  if (!fs.existsSync(TENANT_CONFIG_FILE)) {
    return { tenants: {} };
  }
  return JSON.parse(fs.readFileSync(TENANT_CONFIG_FILE, 'utf-8'));
}

function saveTenantConfig(config: TenantConfig): void {
  fs.writeFileSync(TENANT_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: npm run cdk:tenant:add <tenantId>');
    process.exit(1);
  }

  const tenantId = args[0];
  
  // Validate tenant ID format
  if (!/^[a-zA-Z0-9-]+$/.test(tenantId)) {
    console.error('Error: Tenant ID must contain only alphanumeric characters and hyphens');
    process.exit(1);
  }

  // Load existing tenant configuration
  const config = loadTenantConfig();
  
  // Check if tenant already exists
  if (config.tenants[tenantId]) {
    console.error(`Error: Tenant '${tenantId}' already exists`);
    console.log(`Stack name: ${config.tenants[tenantId].stackName}`);
    process.exit(1);
  }

  const stackName = `TenantIamStack-${tenantId}`;
  
  console.log(`Creating tenant resources for: ${tenantId}`);
  console.log(`IAM Stack name: ${stackName}`);

  try {
    // Deploy the tenant IAM stack
    const cdkCommand = `npx cdk deploy ${stackName} --context tenantId=${tenantId} --require-approval never`;
    console.log(`Running: ${cdkCommand}`);
    
    execSync(cdkCommand, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    // Save tenant configuration
    config.tenants[tenantId] = {
      name: tenantId,
      createdAt: new Date().toISOString(),
      stackName: stackName,
    };
    saveTenantConfig(config);

    console.log(`\nSuccessfully created tenant '${tenantId}' with IAM role`);
    console.log(`Stack: ${stackName}`);
    
    // Output the role ARN (this will be available after stack deployment)
    console.log(`\nTo get the role ARN, run:`);
    console.log(`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey=='TenantRoleArn'].OutputValue" --output text`);
    
  } catch (error) {
    console.error(`\nError deploying tenant resources:`, error);
    process.exit(1);
  }
}

main();