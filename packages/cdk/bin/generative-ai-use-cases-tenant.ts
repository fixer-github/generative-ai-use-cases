#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { createTenantStacks } from '../lib/create-tenant-stacks';
import { StackInput } from '../lib/stack-input';

const app = new cdk.App();

// Read tenant configuration from cdk.tenant.json
let tenantConfig: Partial<StackInput> = {};
const tenantConfigPath = path.join(__dirname, '..', 'cdk.tenant.json');
if (fs.existsSync(tenantConfigPath)) {
  const configContent = fs.readFileSync(tenantConfigPath, 'utf-8');
  const config: Record<string, Partial<StackInput>> = JSON.parse(configContent);
  tenantConfig = config.context || {};
}

// Merge with any context passed via command line (command line takes precedence)
const context = {
  ...tenantConfig,
  ...app.node.getAllContext(),
};

const tenantId = context.tenantId;
if (!tenantId) {
  throw new Error(
    'tenantId must be provided via context (--context tenantId=<value> or in cdk.tenant.json)'
  );
}

// Parse createIamRole from context - CDK context values are strings
const createIamRole =
  context.createIamRole === undefined
    ? true // default to true
    : context.createIamRole !== 'false' && context.createIamRole !== false;

const params = {
  account: context.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: context.tenantRegion || process.env.CDK_DEFAULT_REGION || 'us-east-1',
  tenantId: tenantId,
  identityProviderArn: context.identityProviderArn,
  audience: context.audience,
  tenantIdClaim: context.tenantIdClaim,
  roleName: context.roleName,
  createIamRole: createIamRole,
};

createTenantStacks(app, params);
