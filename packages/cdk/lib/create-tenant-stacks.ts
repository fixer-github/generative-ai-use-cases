import * as cdk from 'aws-cdk-lib';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';
import { TenantS3Stack } from './stacks/tenant/tenant-s3-stack';
import { TenantIAMStack } from './stacks/tenant/tenant-iam-stack';
import { TenantBedrockChatStack } from './stacks/tenant/tenant-bedrock-chat-stack';
import { TenantRegistrationStack } from './stacks/tenant/tenant-registration-stack';

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
      }
    );
  }

  // Tenant Registration Stack (last, after all other stacks)
  // This stack collects information from other stacks and registers them
  const tenantRegistrationStack = new TenantRegistrationStack(
    app,
    `TenantRegistrationStack${params.environment}-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
      environment: params.environment,
      iamRoleArn: tenantIAMStack.getRoleArn(),
      bedrockChatApiArn: tenantBedrockChatStack?.apiHandler.functionArn,
    }
  );

  // Ensure registration stack is deployed after all other stacks
  tenantRegistrationStack.addDependency(tenantIAMStack);
  tenantRegistrationStack.addDependency(tenantDynamoDBStack);
  tenantRegistrationStack.addDependency(tenantS3Stack);
  if (tenantBedrockChatStack) {
    tenantRegistrationStack.addDependency(tenantBedrockChatStack);
  }

  return {
    tenantIAMStack,
    tenantDynamoDBStack,
    tenantS3Stack,
    tenantBedrockChatStack,
    tenantRegistrationStack,
  };
};
