#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getParams } from '../parameter';
import { createStacks } from '../lib/create-stacks';
import { TenantIamStack } from '../lib/tenant-iam-stack';

const app = new cdk.App();
const params = getParams(app);

// Check if we're deploying a tenant IAM stack
const tenantId = app.node.tryGetContext('tenantId');
if (tenantId) {
  // Deploy only the tenant IAM stack
  new TenantIamStack(app, `TenantIamStack-${tenantId}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    tenantId: tenantId,
  });
} else {
  // Deploy the main application stacks
  createStacks(app, params);
}
