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
      dynamoDBModel: DynamoDBModel;
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

const askDynamoDBModel = async (): Promise<DynamoDBModel> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\nSelect DynamoDB model for this tenant:');
    console.log('1. Silo Model - Dedicated table per tenant (better isolation)');
    console.log('2. Pool Model - Shared table with tenant partitioning (cost-effective)');
    
    rl.question('\nEnter your choice (1 or 2): ', (answer) => {
      rl.close();
      resolve(answer === '1' ? 'silo' : 'pool');
    });
  });
};

const main = async () => {
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

  // Ask for DynamoDB model selection
  const dynamoDBModel = await askDynamoDBModel();
  
  const stackName = `TenantDynamoDBStack-${tenantId}`;
  
  console.log(`\nCreating tenant resources for: ${tenantId}`);
  console.log(`DynamoDB Model: ${dynamoDBModel}`);
  console.log(`Stack name: ${stackName}`);

  try {
    // Deploy the tenant DynamoDB stack
    const cdkCommand = `npx cdk deploy ${stackName} --context tenantId=${tenantId} --context dynamoDBModel=${dynamoDBModel} --require-approval never`;
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
      dynamoDBModel: dynamoDBModel,
    };
    saveTenantConfig(config);

    console.log(`\nSuccessfully created tenant '${tenantId}' with DynamoDB ${dynamoDBModel} model`);
    console.log(`Stack: ${stackName}`);
    
    // Output the role ARN (this will be available after stack deployment)
    console.log(`\nTo get the role ARN, run:`);
    console.log(`aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey=='TenantRoleArn'].OutputValue" --output text`);
    
    if (dynamoDBModel === 'silo') {
      console.log(`\nDedicated DynamoDB table created for tenant: ${tenantId}`);
    } else {
      console.log(`\nTenant ${tenantId} will use the shared DynamoDB table with partition key isolation`);
    }
    
  } catch (error) {
    console.error(`\nError deploying tenant resources:`, error);
    process.exit(1);
  }
};

main();