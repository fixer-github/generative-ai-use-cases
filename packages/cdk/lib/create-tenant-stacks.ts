import * as cdk from 'aws-cdk-lib';
import { TenantIamRoleStack } from './stacks/tenant/tenant-iam-role-stack';
import { TenantDynamoDBStack } from './stacks/tenant/tenant-dynamodb-stack';

export interface TenantStackInput {
  account?: string;
  region: string;
  tenantId: string;
  identityProviderArn?: string;
  audience?: string;
  tenantIdClaim?: string;
  roleName?: string;
  createIamRole?: boolean;
}

export const createTenantStacks = (app: cdk.App, params: TenantStackInput) => {
  // Default to true for backward compatibility
  const shouldCreateIamRole = params.createIamRole !== false;

  let tenantIamRoleStack: TenantIamRoleStack | undefined;

  // Conditionally create Tenant IAM Role Stack
  if (shouldCreateIamRole) {
    tenantIamRoleStack = new TenantIamRoleStack(
      app,
      `TenantStack-${params.tenantId}`,
      {
        env: {
          account: params.account,
          region: params.region,
        },
        identityProviderArn: params.identityProviderArn,
        audience: params.audience,
        tenantIdClaim: params.tenantIdClaim,
        roleName: params.roleName || `TenantRole-${params.tenantId}`,
      }
    );
  }

  // Tenant DynamoDB Stack
  const tenantDynamoDBStack = new TenantDynamoDBStack(
    app,
    `TenantDynamoDBStack-${params.tenantId}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      tenantId: params.tenantId,
    }
  );

  return {
    tenantIamRoleStack,
    tenantDynamoDBStack,
  };
};
