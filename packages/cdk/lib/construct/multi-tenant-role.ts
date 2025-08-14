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

    // Add S3 access policy for tenant-specific buckets using PrincipalTag
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
          // Bucket-level permissions (stack-specific)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-\${aws:PrincipalTag/TenantID}`,
          // Object-level permissions (stack-specific)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-\${aws:PrincipalTag/TenantID}/*`,
        ],
      })
    );

    // Add DynamoDB access policy for tenant-specific tables using PrincipalTag
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
          // Allow access to tables with tenant-specific naming pattern
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-\${aws:PrincipalTag/TenantID}`,
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-\${aws:PrincipalTag/TenantID}/index/*`,
        ],
      })
    );

    // Add condition to deny access to tenant resources without proper TenantID tag
    // Only applies to tenant-specific resources (not all resources)
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'DenyTenantResourceAccessWithoutTenantTag',
        effect: Effect.DENY,
        actions: [
          'dynamodb:*',
          's3:*',
        ],
        resources: [
          // Only deny access to tenant-specific resources, not all resources
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*`,
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*/index/*`,
          `arn:aws:s3:::*-tenant-*`,
          `arn:aws:s3:::*-tenant-*/*`,
        ],
        conditions: {
          Null: {
            'aws:PrincipalTag/TenantID': 'true',
          },
        },
      })
    );

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

    // Configure trust policy to allow session tagging via escape hatch
    // This enables AssumeRoleWithWebIdentity to pass session tags
    const cfnRole = this.role.node.defaultChild as CfnRole;
    
    // Create CfnJson objects to handle token resolution at deployment time
    const trustPolicyCondition = new CfnJson(this, 'TrustPolicyCondition', {
      value: {
        StringEquals: {
          [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]: 
            props.userPoolClient.userPoolClientId,
        },
      },
    });
    
    cfnRole.addPropertyOverride('AssumeRolePolicyDocument', {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`,
          },
          Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
          Condition: trustPolicyCondition,
        },
      ],
    });
  }
}
