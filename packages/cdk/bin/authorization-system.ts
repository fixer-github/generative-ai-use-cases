#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { AuthorizationStack } from '../lib/stacks/standalone/authorization-stack';

const app = new cdk.App();

/**
 * Authorization Configuration
 */
interface AuthorizationConfig {
  environment?: string;
  deploymentId?: string;
  vpcConfig?: {
    createNew?: boolean;
    vpcId?: string;
    vpcCidr?: string;
    maxAzs?: number;
    natGateways?: number;
  };
  openFgaConfig?: {
    imageTag?: string;
    cpu?: number;
    memoryLimitMiB?: number;
    desiredCount?: number;
    minCapacity?: number;
    maxCapacity?: number;
    enablePlayground?: boolean;
  };
  databaseConfig?: {
    instanceType?: string;
    multiAz?: boolean;
    allocatedStorageGb?: number;
    backupRetentionDays?: number;
    deletionProtection?: boolean;
  };
  authorizerConfig?: {
    enableCache?: boolean;
    cacheTTLSeconds?: number;
  };
  userPoolId?: string;
  userPoolClientId?: string;
}

// Read authorization configuration from cdk.authorization.json
let authorizationConfig: AuthorizationConfig = {};
const authzConfigPath = path.join(__dirname, '..', 'cdk.authorization.json');
if (fs.existsSync(authzConfigPath)) {
  const configContent = fs.readFileSync(authzConfigPath, 'utf-8');
  const config: { context?: AuthorizationConfig } = JSON.parse(configContent);
  authorizationConfig = config.context || {};
}

// Merge with any context passed via command line (command line takes precedence)
const context = {
  ...authorizationConfig,
  ...app.node.getAllContext(),
};

// Set the merged context back to the app
Object.keys(authorizationConfig).forEach((key) => {
  if (!(key in app.node.getAllContext())) {
    app.node.setContext(key, (authorizationConfig as any)[key]);
  }
});

// Validate required fields
const environment = context.environment;
if (!environment) {
  throw new Error(
    'environment must be provided via context (--context environment=<value> or in cdk.authorization.json)'
  );
}

// VPC configuration validation
const vpcConfig = context.vpcConfig || { createNew: true };
if (!vpcConfig.createNew && !vpcConfig.vpcId) {
  throw new Error(
    'vpcId must be provided when vpcConfig.createNew is false'
  );
}

// Build stack parameters
const stackId = `AuthorizationStack${environment}${context.deploymentId ? `-${context.deploymentId}` : ''}`;

new AuthorizationStack(app, stackId, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment: environment,
  deploymentId: context.deploymentId,
  vpcConfig: {
    createNew: vpcConfig.createNew ?? true,
    vpcId: vpcConfig.vpcId,
    vpcCidr: vpcConfig.vpcCidr,
    maxAzs: vpcConfig.maxAzs,
    natGateways: vpcConfig.natGateways,
  },
  openFgaConfig: context.openFgaConfig,
  databaseConfig: context.databaseConfig,
  authorizerConfig: context.authorizerConfig,
  userPoolId: context.userPoolId,
  userPoolClientId: context.userPoolClientId,
  description: `Standalone Authorization System for ${environment} environment`,
  tags: {
    Stack: 'AuthorizationStack',
    Environment: environment,
    DeploymentId: context.deploymentId || 'default',
  },
});
