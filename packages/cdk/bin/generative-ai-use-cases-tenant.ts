#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { createTenantStacks } from '../lib/create-tenant-stacks';

const app = new cdk.App();

// Get tenant-specific parameters from context
const tenantId = app.node.tryGetContext('tenantId');
if (!tenantId) {
  throw new Error('tenantId must be provided via context (--context tenantId=<value>)');
}

const params = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('tenantRegion') || process.env.CDK_DEFAULT_REGION || 'us-east-1',
  tenantId: tenantId,
  identityProviderArn: app.node.tryGetContext('identityProviderArn'),
  audience: app.node.tryGetContext('audience'),
  tenantIdClaim: app.node.tryGetContext('tenantIdClaim'),
  roleName: app.node.tryGetContext('roleName'),
};

createTenantStacks(app, params);