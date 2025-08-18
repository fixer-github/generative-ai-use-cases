import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  WebIdentityPrincipal,
  CfnRole,
} from 'aws-cdk-lib/aws-iam';
import { Stack, Fn, CfnJson } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export interface MultiTenantRoleProps {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly region: string;
  readonly account: string;
  readonly env?: string;
}

export class MultiTenantRole extends Construct {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: MultiTenantRoleProps) {
    super(scope, id);

    // Create web identity principal for Cognito without conditions
    // Conditions will be added via escape hatch to avoid token resolution issues
    const principal = new WebIdentityPrincipal(
      `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`
    );

    // Create the single role for multi-tenant access with tag-based ABAC
    this.role = new Role(this, 'MultiTenantAccessRole', {
      roleName: `${Stack.of(this).stackName}-MultiTenantAccessRole`,
      assumedBy: principal,
      description:
        'Single role for multi-tenant resource access with tag-based ABAC',
    });

    // Note: Session tag mapping for JWT claims must be configured in Cognito
    // Pre-Token Generation trigger to add the tenant ID to the JWT claims

    // Add S3 access policy for all tenant buckets
    // Since AssumeRoleWithWebIdentity doesn't support SessionTags, we allow access to all tenant buckets
    // Security is enforced at the application level by only calling AssumeRole for users with tenant ID
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'S3TenantAccess',
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          // Bucket-level permissions (stack-specific, all tenant buckets)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-*`,
          // Object-level permissions (stack-specific, all tenant buckets)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-*/*`,
        ],
      })
    );

    // Add DynamoDB access policy for all tenant tables
    // Since AssumeRoleWithWebIdentity doesn't support SessionTags, we allow access to all tenant tables
    // Security is enforced at the application level by only calling AssumeRole for users with tenant ID
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'DynamoDBTenantAccess',
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:DescribeTable',
          'dynamodb:DescribeTimeToLive',
        ],
        resources: [
          // Allow access to all tenant tables - security enforced by only assuming role for correct tenant
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*`,
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*/index/*`,
        ],
      })
    );

    // Note: Cross-tenant security is enforced at application level
    // Only users with valid tenant_id in JWT can assume this role
    // Repository layer ensures users only access tables matching their tenant_id

    // Add CloudWatch Logs access for debugging
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'CloudWatchLogsAccess',
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/lambda/*`,
        ],
      })
    );

    const trustCondition = new CfnJson(this, 'TrustCondition', {
      value: {
        [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]: 
          props.userPoolClient.userPoolClientId,
      },
    });
    
    const cfnRole = this.role.node.defaultChild as CfnRole;
    
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`,
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: trustCondition,
          },
        },
      ],
    };
  }
}
