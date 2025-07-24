#!/usr/bin/env node
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

function main() {
  const config = loadTenantConfig();
  const tenantIds = Object.keys(config.tenants);

  if (tenantIds.length === 0) {
    console.log('No tenants configured yet.');
    console.log('Use "npm run cdk:tenant:add <tenantId>" to add a new tenant.');
    return;
  }

  console.log('Configured Tenants:');
  console.log('==================');
  
  tenantIds.forEach(tenantId => {
    const tenant = config.tenants[tenantId];
    console.log(`\nTenant ID: ${tenantId}`);
    console.log(`  Name: ${tenant.name}`);
    console.log(`  Created: ${new Date(tenant.createdAt).toLocaleString()}`);
    console.log(`  Stack: ${tenant.stackName}`);
  });

  console.log('\n\nTenant Management Commands:');
  console.log('- Add tenant:    npm run cdk:tenant:add <tenantId>');
  console.log('- Remove tenant: npm run cdk:tenant:remove <tenantId>');
  console.log('\nTo get role ARN for a tenant:');
  console.log('aws cloudformation describe-stacks --stack-name <stackName> --query "Stacks[0].Outputs[?OutputKey==\'TenantRoleArn\'].OutputValue" --output text');
}

main();