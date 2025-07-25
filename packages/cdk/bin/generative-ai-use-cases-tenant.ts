#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { createTenantStacks } from '../lib/create-tenant-stacks';

const app = new cdk.App();

// Read tenant configuration from cdk.tenant.json
let tenantConfig: any = {};
const tenantConfigPath = path.join(__dirname, '..', 'cdk.tenant.json');
if (fs.existsSync(tenantConfigPath)) {
  const configContent = fs.readFileSync(tenantConfigPath, 'utf-8');
  const config = JSON.parse(configContent);
  tenantConfig = config.context || {};
}

// Merge with any context passed via command line (command line takes precedence)
const context = {
  ...tenantConfig,
  ...app.node.getAllContext()
};

const tenantId = context.tenantId;
if (!tenantId) {
  throw new Error('tenantId must be provided via context (--context tenantId=<value> or in cdk.tenant.json)');
}

const params = {
  account: context.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: context.tenantRegion || process.env.CDK_DEFAULT_REGION || 'us-east-1',
  tenantId: tenantId,
  identityProviderArn: context.identityProviderArn,
  audience: context.audience,
  tenantIdClaim: context.tenantIdClaim,
  roleName: context.roleName,
};

createTenantStacks(app, params);
