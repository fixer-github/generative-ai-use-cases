import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';
import { TenantS3Stack } from './stacks/tenant/tenant-s3-stack';
import { TenantIAMStack } from './stacks/tenant/tenant-iam-stack';
import { TenantPptxStack } from './stacks/tenant/tenant-pptx-stack';
import { TenantVpcStack } from './stacks/tenant/tenant-vpc-stack';

export interface NetworkConfig {
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
}

export interface IpAccessControlConfig {
  enabled: boolean;
  allowedIpV4AddressRanges: string[];
  allowedIpV6AddressRanges: string[];
}

export interface TenantStackInput {
  account?: string;
  region: string;
  tenantId: string;
  environment: string;
  removalPolicy: boolean;
  bedrockRegion?: string;
  pptxEnabled?: boolean;
  userPoolId?: string;
  identityPoolId?: string;
  userPoolClientId?: string;
  // OpenSearch is now unified - no per-tenant OpenSearch configuration needed
  // The unified OpenSearch endpoint is provided via environment variables
  networkConfig: NetworkConfig;
  ipAccessControl?: IpAccessControlConfig;
  controlPlaneRegion?: string;
  controlPlaneAccount?: string;
  tenantsTableName?: string;
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

  // Tenant VPC Stack (for networking infrastructure - used by OpenFGA, RDS, etc.)
  // Note: OpenSearch is now unified and doesn't require per-tenant VPC
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
  // OpenSearch is now unified in UnifiedOpenSearchStack for both:
  // - Bedrock Knowledge Base (vector search)
  // - Tenant assistant RAG documents
  // All tenants share the unified OpenSearch domain with data isolation
  // via metadata.assistantId filtering.

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
    tenantPptxStack,
  };
};
