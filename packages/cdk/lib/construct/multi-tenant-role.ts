import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  PolicyDocument,
  FederatedPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export class MultiTenantRole extends Construct {
  constructor(scope, id, props) {
    super(scope, id);

    // Get the OIDC provider ARN from the user pool
    const oidcProviderArn = Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      account: props.account,
      resource: 'oidc-provider',
      resourceName: `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`,
    });

    // Create federated principal for Cognito OIDC provider
    const principal = new FederatedPrincipal(
      oidcProviderArn,
      {
        StringEquals: {
          [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]:
            props.userPoolClient.userPoolClientId,
          [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:amr`]:
            'authenticated',
        },
      },
      'sts:AssumeRoleWithWebIdentity'
    );

    // Create trust policy that maps JWT claims to session tags
    const trustPolicy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          principals: [principal],
          actions: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
          conditions: {
            StringEquals: {
              [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]:
                props.userPoolClient.userPoolClientId,
              [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:amr`]:
                'authenticated',
            },
          },
        }),
      ],
    });

    // Create the single role for multi-tenant access with tag-based ABAC
    this.role = new Role(this, 'MultiTenantAccessRole', {
      roleName: `${Stack.of(this).stackName}-MultiTenantAccessRole`,
      assumedBy: principal,
      inlinePolicies: {
        AssumeRolePolicy: trustPolicy,
      },
      description:
        'Single role for multi-tenant resource access with tag-based ABAC',
    });

    // Add tag mapping to the trust relationship
    // This maps the tenant ID from JWT claims to a session tag
    const trustRelationship = this.role.assumeRolePolicy;
    trustRelationship.addStatements(
      new PolicyStatement({
        sid: 'AllowPassSessionTagsFromJWT',
        effect: Effect.ALLOW,
        principals: [principal],
        actions: ['sts:TagSession'],
        conditions: {
          StringLike: {
            'aws:RequestTag/TenantID': '*',
          },
        },
      })
    );

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