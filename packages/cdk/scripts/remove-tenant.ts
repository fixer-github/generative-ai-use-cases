#!/usr/bin/env node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const TENANT_CONFIG_FILE = path.join(__dirname, '../tenant-config.json');

type DynamoDBModel = 'silo' | 'pool';

interface TenantConfig {
  tenants: {
    [tenantId: string]: {
      name: string;
      createdAt: string;
      stackName: string;
      dynamoDBModel?: DynamoDBModel;
    };
  };
}

const loadTenantConfig = (): TenantConfig => {
  if (!fs.existsSync(TENANT_CONFIG_FILE)) {
    return { tenants: {} };
  }
  return JSON.parse(fs.readFileSync(TENANT_CONFIG_FILE, 'utf-8'));
};

const saveTenantConfig = (config: TenantConfig): void => {
  fs.writeFileSync(TENANT_CONFIG_FILE, JSON.stringify(config, null, 2));
};

const askConfirmation = async (question: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: npm run cdk:tenant:remove <tenantId>');
    process.exit(1);
  }

  const tenantId = args[0];
  
  // Load existing tenant configuration
  const config = loadTenantConfig();
  
  // Check if tenant exists
  if (!config.tenants[tenantId]) {
    console.error(`Error: Tenant '${tenantId}' not found`);
    console.log('Use "npm run cdk:tenant:list" to see all configured tenants.');
    process.exit(1);
  }

  const tenant = config.tenants[tenantId];
  console.log(`Tenant to remove: ${tenantId}`);
  console.log(`  Stack: ${tenant.stackName}`);
  console.log(`  Created: ${new Date(tenant.createdAt).toLocaleString()}`);
  console.log(`  DynamoDB Model: ${tenant.dynamoDBModel || 'Not specified'}`);

  const confirmed = await askConfirmation('\nAre you sure you want to remove this tenant? (y/N): ');
  
  if (!confirmed) {
    console.log('Operation cancelled.');
    process.exit(0);
  }

  console.log(`\nRemoving tenant resources for: ${tenantId}`);

  try {
    // Destroy the tenant DynamoDB stack
    const cdkCommand = `npx cdk destroy ${tenant.stackName} --force`;
    console.log(`Running: ${cdkCommand}`);
    
    execSync(cdkCommand, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    // Remove tenant from configuration
    delete config.tenants[tenantId];
    saveTenantConfig(config);

    console.log(`\nSuccessfully removed tenant '${tenantId}'`);
    
  } catch (error) {
    console.error(`\nError destroying tenant resources:`, error);
    process.exit(1);
  }
};

main();