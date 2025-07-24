#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getParams } from '../parameter';
import { createStacks } from '../lib/create-stacks';
import { TenantDynamoDBStack } from '../lib/tenant-dynamodb-stack';

const app = new cdk.App();
const params = getParams(app);

// Check if we're deploying a tenant DynamoDB stack
const tenantId = app.node.tryGetContext('tenantId');
const dynamoDBModel = app.node.tryGetContext('dynamoDBModel') as 'silo' | 'pool';

if (tenantId && dynamoDBModel) {
  // Deploy only the tenant DynamoDB stack
  new TenantDynamoDBStack(app, `TenantDynamoDBStack-${tenantId}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    tenantId: tenantId,
    dynamoDBModel: dynamoDBModel,
  });
} else {
  // Deploy the main application stacks
  createStacks(app, params);
}
