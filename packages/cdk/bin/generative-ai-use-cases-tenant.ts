#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { createTenantStacks } from '../lib/create-tenant-stacks';

const app = new cdk.App();

// Get all context values (from cdk.tenant.json when using npm run cdk:*:tenant commands)
const context = app.node.getAllContext();

const tenantId = context.tenantId;
if (!tenantId) {
  throw new Error('tenantId must be provided via context (--context tenantId=<value>)');
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
