import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';
import { TenantS3Stack } from './stacks/tenant/tenant-s3-stack';
import { TenantIAMStack } from './stacks/tenant/tenant-iam-stack';
import { TenantBedrockChatStack } from './stacks/tenant/tenant-bedrock-chat-stack';
import { TenantPptxStack } from './stacks/tenant/tenant-pptx-stack';
import { TenantVpcStack } from './stacks/tenant/tenant-vpc-stack';
import { TenantOpenSearchStack } from './stacks/tenant/tenant-opensearch-stack';
import { TenantAuthorizationStack } from './stacks/tenant/tenant-authorization-stack';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface NetworkConfig {
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
}

export interface OpenSearchConfig {
  capacity: opensearch.CapacityConfig;
  ebsVolumeSize: number;
  ebsVolumeType: ec2.EbsDeviceVolumeType;
  availabilityZoneCount: number;
  automatedSnapshotStartHour: number;
}

export interface AuthorizationConfig {
  /**
   * Enable authorization stack deployment
   * @default true
   */
  enabled?: boolean;

  /**
   * Enable authorization cache
   * @default true
   */
  enableCache?: boolean;

  /**
   * Cache TTL in seconds
   * @default 300
   */
  cacheTTLSeconds?: number;

  /**
   * Enable OpenFGA playground (development only)
   * @default false
   */
  enablePlayground?: boolean;

  /**
   * OpenFGA container image tag
   * @default 'latest'
   */
  openFgaImageTag?: string;

  /**
   * Multi-AZ deployment for RDS
   * @default false
   */
  multiAz?: boolean;

  /**
   * Enable deletion protection for RDS
   * @default true
   */
  deletionProtection?: boolean;
}

export interface TenantStackInput {
  account?: string;
  region: string;
  tenantId: string;
  environment: string;
  removalPolicy: boolean;
  bedrockRegion?: string;
  enableBedrockChat?: boolean;
  pptxEnabled?: boolean;
  userPoolId?: string;
  identityPoolId?: string;
  userPoolClientId?: string;
  openSearchConfig: OpenSearchConfig;
  networkConfig: NetworkConfig;
  authorizationConfig?: AuthorizationConfig;
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

  // Tenant Authorization Stack (optional, enabled by default)
  let tenantAuthorizationStack;
  const authzConfig = params.authorizationConfig;
  if (authzConfig?.enabled !== false && params.userPoolId) {
    tenantAuthorizationStack = new TenantAuthorizationStack(
      app,
      `TenantAuthorizationStack${params.environment}-${params.tenantId}`,
      {
        env: {
          account: params.account,
          region: params.region,
        },
        tenantId: params.tenantId,
        environment: params.environment,
        vpc: tenantVpcStack.vpc,
        userPoolId: params.userPoolId,
        userPoolClientId: params.userPoolClientId,
        enableCache: authzConfig?.enableCache ?? true,
        cacheTTLSeconds: authzConfig?.cacheTTLSeconds ?? 300,
        enablePlayground: authzConfig?.enablePlayground ?? false,
        openFgaImageTag: authzConfig?.openFgaImageTag,
        multiAz: authzConfig?.multiAz ?? false,
        deletionProtection: authzConfig?.deletionProtection ?? true,
        removalPolicy: params.removalPolicy,
      }
    );

    // Add dependency to ensure VPC is created before Authorization System
    tenantAuthorizationStack.addDependency(tenantVpcStack);
  }

  // Tenant Managed OpenSearch Stack
  const tenantOpenSearchStack = new TenantOpenSearchStack(
    app,
    `TenantOpenSearchStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      vpc: tenantVpcStack.vpc,
      subnets: tenantVpcStack.privateSubnets,
      capacity: params.openSearchConfig.capacity,
      ebsVolumeSize: params.openSearchConfig.ebsVolumeSize,
      ebsVolumeType: params.openSearchConfig.ebsVolumeType,
      availabilityZoneCount: params.openSearchConfig.availabilityZoneCount,
      automatedSnapshotStartHour:
        params.openSearchConfig.automatedSnapshotStartHour,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    }
  );

  // Add dependency to ensure VPC is created before OpenSearch
  tenantOpenSearchStack.addDependency(tenantVpcStack);

  // Tenant Bedrock Chat Stack (optional)
  let tenantBedrockChatStack;
  if (params.enableBedrockChat) {
    tenantBedrockChatStack = new TenantBedrockChatStack(
      app,
      `TenantBedrockChatStack${params.environment}-${params.tenantId}`,
      {
        env: {
          account: params.account,
          region: params.region,
        },
        tenantId: params.tenantId,
        environment: params.environment,
        bedrockRegion: params.bedrockRegion || params.region,
        openSearchDomainEndpoint: tenantOpenSearchStack.domainEndpoint,
        openSearchDomainArn: tenantOpenSearchStack.domainArn,
        removalPolicy: params.removalPolicy
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      }
    );
    tenantBedrockChatStack.addDependency(tenantOpenSearchStack);
  }

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

  return {
    tenantIAMStack,
    tenantDynamoDBStack,
    tenantS3Stack,
    tenantVpcStack,
    tenantAuthorizationStack,
    tenantOpenSearchStack,
    tenantBedrockChatStack,
    tenantPptxStack,
  };
};
