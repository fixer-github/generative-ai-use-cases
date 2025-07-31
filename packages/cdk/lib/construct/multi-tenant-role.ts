import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  PolicyDocument,
  FederatedPrincipal,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export interface MultiTenantRoleProps {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly region: string;
  readonly account: string;
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
          // Bucket-level permissions
          `arn:aws:s3:::*-tenant-\${aws:PrincipalTag/TenantID}`,
          // Object-level permissions
          `arn:aws:s3:::*-tenant-\${aws:PrincipalTag/TenantID}/*`,
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

    // Add a condition to ensure TenantID tag is always present
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'DenyAccessWithoutTenantTag',
        effect: Effect.DENY,
        actions: ['*'],
        resources: ['*'],
        conditions: {
          'Null': {
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
  }
}