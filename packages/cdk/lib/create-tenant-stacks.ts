import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';
import { TenantS3Stack } from './stacks/tenant/tenant-s3-stack';
import { TenantIAMStack } from './stacks/tenant/tenant-iam-stack';
import { TenantBedrockChatStack } from './stacks/tenant/tenant-bedrock-chat-stack';
import { TenantVpcStack } from './stacks/tenant/tenant-vpc-stack';
import { TenantOpenSearchStack } from './stacks/tenant/tenant-opensearch-stack';

export interface TenantStackInput {
  account?: string;
  region: string;
  tenantId: string;
  environment: string;
  removalPolicy: boolean;
  bedrockRegion?: string;
  enableBedrockChat?: boolean;
  userPoolId?: string;
  identityPoolId?: string;
  userPoolClientId?: string;
  opensearchCapacity?: string;
  vpcCidr?: string;
  masterUserArn?: string;
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

  // Tenant VPC Stack
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
      vpcCidr: params.vpcCidr,
    }
  );

  // Tenant OpenSearch Stack
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
      opensearchCapacity: params.opensearchCapacity,
      masterUserArn: params.masterUserArn,
      removalPolicy: params.removalPolicy
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    }
  );
  // Add dependency to ensure VPC is created first
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
        removalPolicy: params.removalPolicy
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
        opensearchDomainEndpoint: tenantOpenSearchStack.domainEndpoint,
        opensearchDomainArn: tenantOpenSearchStack.domain.domainArn,
      }
    );
    // Add dependency to ensure OpenSearch is created first
    tenantBedrockChatStack.addDependency(tenantOpenSearchStack);
  }

  return {
    tenantIAMStack,
    tenantDynamoDBStack,
    tenantS3Stack,
    tenantVpcStack,
    tenantOpenSearchStack,
    tenantBedrockChatStack,
  };
};
