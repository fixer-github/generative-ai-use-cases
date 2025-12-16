import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';
import { TenantS3Stack } from './stacks/tenant/tenant-s3-stack';
import { TenantIAMStack } from './stacks/tenant/tenant-iam-stack';
import { TenantPptxStack } from './stacks/tenant/tenant-pptx-stack';
import { TenantVpcStack } from './stacks/tenant/tenant-vpc-stack';
// Note: TenantOpenSearchStack has been replaced by UnifiedOpenSearchStack
// import { TenantOpenSearchStack } from './stacks/tenant/tenant-opensearch-stack';
import { TenantOpenFgaStack } from './stacks/tenant/tenant-openfga-stack';
import { TenantPaymentGatewayStack } from './stacks/tenant/tenant-payment-gateway-stack';
import { TenantRdsStack } from './stacks/tenant/tenant-rds-stack';
import { TenantAuthorizationDbStack } from './stacks/tenant/tenant-authorization-db-stack';
import { TenantOrchestrationDbStack } from './stacks/tenant/tenant-orchestration-db-stack';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface NetworkConfig {
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
}

// Note: OpenSearchConfig has been removed.
// OpenSearch is now managed by the unified OpenSearchStack in the common stack.
// Tenants share the unified OpenSearch domain with index-level isolation.
export interface IpAccessControlConfig {
  enabled: boolean;
  allowedIpV4AddressRanges: string[];
  allowedIpV6AddressRanges: string[];
}

export interface OpenFgaConfig {
  rds: {
    instanceClass: string;
    instanceSize: string;
    allocatedStorage: number;
    maxAllocatedStorage: number;
    storageType: string;
    backupRetentionDays: number;
    preferredBackupWindow: string;
    preferredMaintenanceWindow: string;
    enablePerformanceInsights: boolean;
    deletionProtection: boolean;
  };
  ecs: {
    cpu: number;
    memoryLimitMiB: number;
    minCapacity: number;
    maxCapacity: number;
    cpuTargetUtilizationPercent?: number;
    memoryTargetUtilizationPercent?: number;
    scaleOutCooldownSeconds?: number;
    scaleInCooldownSeconds?: number;
    /**
     * Schedule-based scaling configurations.
     * @example
     * scheduledScaling: [
     *   { scheduleName: "ScaleUpMorning", schedule: "cron(0 9 * * ? *)", minCapacity: 2 },
     *   { scheduleName: "ScaleDownNight", schedule: "cron(0 21 * * ? *)", maxCapacity: 1 }
     * ]
     */
    scheduledScaling?: Array<{
      /** Unique identifier for this schedule. Must be alphanumeric (used as CloudFormation logical ID). */
      scheduleName: string;
      /** Cron or rate expression. e.g., "cron(0 9 * * ? *)" or "rate(1 hour)" */
      schedule: string;
      minCapacity?: number;
      maxCapacity?: number;
    }>;
    imageVersion: string;
  };
  logging: {
    retentionDays: number;
  };
  apiGateway: {
    loggingLevel: string;
    dataTraceEnabled: boolean;
  };
}

export interface TenantStackInput {
  account?: string;
  region: string;
  tenantId: string;
  environment: string;
  removalPolicy: boolean;
  bedrockRegion?: string;
  pptxEnabled?: boolean;
  paymentGatewayEnabled?: boolean;
  userPoolId?: string;
  identityPoolId?: string;
  userPoolClientId?: string;
  // Note: openSearchConfig has been removed - OpenSearch is now unified
  networkConfig: NetworkConfig;
  ipAccessControl?: IpAccessControlConfig;
  controlPlaneRegion?: string;
  controlPlaneAccount?: string;
  tenantsTableName?: string;
  // Note: openSearchIndexName has been removed - using unified index
  openFgaConfig: OpenFgaConfig;
  controlPlaneLambdaRoleArn?: string;
}

export const createTenantStacks = (app: cdk.App, params: TenantStackInput) => {
  // Phase 1: Tenant IAM Stack (create first for role ARN export)
  // Note: UserPool and IdentityPool are imported via CloudFormation parameters
  const tenantIAMStack = new TenantIAMStack(
    app,
    `TenantIAMStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      ipAccessControl: params.ipAccessControl,
    }
  );

  // Tenant DynamoDB Stack
  const tenantDynamoDBStack = new TenantDynamoDBStack(
    app,
    `TenantDynamoDBStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
    }
  );

  // Tenant S3 Stack
  const tenantS3Stack = new TenantS3Stack(
    app,
    `TenantS3Stack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      removalPolicy: params.removalPolicy,
    }
  );

  // Tenant VPC Stack (for networking infrastructure)
  const tenantVpcStack = new TenantVpcStack(
    app,
    `TenantVpcStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      vpcCidr: params.networkConfig.vpcCidr,
      maxAzs: params.networkConfig.maxAzs,
      natGateways: params.networkConfig.natGateways,
    }
  );

  // Note: TenantOpenSearchStack has been removed.
  // OpenSearch is now managed by the unified OpenSearchStack in the common stack.
  // All tenants share the unified OpenSearch domain with index-level isolation
  // using metadata.assistantId for document filtering.

  // Tenant PPTX Stack (optional)
  let tenantPptxStack;
  if (params.pptxEnabled) {
    tenantPptxStack = new TenantPptxStack(
      app,
      `TenantPptxStack${params.environment}-${params.tenantId}`,
      {
        env: {
          account: params.account,
          region: params.region,
        },
        tenantId: params.tenantId,
        environment: params.environment,
        removalPolicy: params.removalPolicy,
      }
    );
  }

  // Tenant OpenFGA Stack (required)
  const tenantOpenFgaStack = new TenantOpenFgaStack(
    app,
    `TenantOpenFgaStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      vpc: tenantVpcStack.vpc,
      subnets: tenantVpcStack.privateSubnets,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      controlPlaneLambdaRoleArn: params.controlPlaneLambdaRoleArn,
      tenantRoleArn: tenantIAMStack.getRoleArn(),
      openFgaConfig: params.openFgaConfig,
    }
  );
  tenantOpenFgaStack.addDependency(tenantVpcStack);
  tenantOpenFgaStack.addDependency(tenantIAMStack);

  // Tenant RDS Stack (for plan and subscription management)
  const tenantRdsStack = new TenantRdsStack(
    app,
    `TenantRdsStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      vpc: tenantVpcStack.vpc,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.SNAPSHOT,
      // deletionProtection is the inverse of enableAutoDelete (removalPolicy)
      deletionProtection: !params.removalPolicy,
    }
  );
  tenantRdsStack.addDependency(tenantVpcStack);

  // Tenant Authorization DB Stack (DynamoDB tables only)
  // Lambda functions and EventBridge are managed in the common AuthorizationFunctionsStack
  const tenantAuthorizationDbStack = new TenantAuthorizationDbStack(
    app,
    `TenantAuthorizationDbStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    }
  );
  tenantAuthorizationDbStack.addDependency(tenantIAMStack);

  // Tenant Orchestration DB Stack (DynamoDB tables for idempotency and flow execution history)
  // Lambda functions are managed in the common OrchestrationApi construct
  const tenantOrchestrationDbStack = new TenantOrchestrationDbStack(
    app,
    `TenantOrchestrationDbStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    }
  );
  tenantOrchestrationDbStack.addDependency(tenantIAMStack);

  // Tenant Payment Gateway Stack (optional)
  let tenantPaymentGatewayStack;
  if (params.paymentGatewayEnabled) {
    tenantPaymentGatewayStack = new TenantPaymentGatewayStack(
      app,
      `TenantPaymentGatewayStack${params.environment}-${params.tenantId}`,
      {
        env: {
          account: params.account,
          region: params.region,
        },
        tenantId: params.tenantId,
        environment: params.environment,
        removalPolicy: params.removalPolicy
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      }
    );
  }

  return {
    tenantIAMStack,
    tenantDynamoDBStack,
    tenantS3Stack,
    tenantVpcStack,
    // Note: tenantOpenSearchStack removed - using unified OpenSearch
    tenantPptxStack,
    tenantOpenFgaStack,
    tenantRdsStack,
    tenantAuthorizationDbStack,
    tenantOrchestrationDbStack,
    tenantPaymentGatewayStack,
  };
};
