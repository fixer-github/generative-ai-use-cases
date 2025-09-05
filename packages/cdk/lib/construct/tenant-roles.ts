import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  FederatedPrincipal,
  PolicyDocument,
} from 'aws-cdk-lib/aws-iam';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

export interface TenantRolesProps {
  readonly userPool: UserPool;
  readonly identityPool: IdentityPool;
  readonly region: string;
  readonly account: string;
  readonly env?: string;
  readonly tenantIds: string[]; // Array of tenant IDs to create roles for
}

export class TenantRoles extends Construct {
  readonly roles: Map<string, Role> = new Map();

  constructor(scope: Construct, id: string, props: TenantRolesProps) {
    super(scope, id);

    // Create individual role for each tenant
    props.tenantIds.forEach((tenantId) => {
      const role = this.createTenantRole(tenantId, props);
      this.roles.set(tenantId, role);
    });
  }

  private createTenantRole(tenantId: string, props: TenantRolesProps): Role {
    const role = new Role(this, `TenantRole-${tenantId}`, {
      roleName: `TenantRole-${tenantId}`,
      description: `IAM role for tenant ${tenantId} - Phase 1 same account access`,
      assumedBy: new FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': props.identityPool.identityPoolId,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
          // JWT validation is handled by Cognito
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      inlinePolicies: {
        TenantResourceAccess: new PolicyDocument({
          statements: [
            // S3 access for tenant-specific buckets (clean naming without PrincipalTag conditions)
            new PolicyStatement({
              sid: 'S3TenantAccess',
              effect: Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
                's3:GetBucketLocation',
                's3:ListBucketMultipartUploads',
                's3:AbortMultipartUpload',
                's3:ListMultipartUploadParts',
              ],
              resources: [
                // Bucket-level permissions for clean tenant naming
                `arn:aws:s3:::*-${props.env}-tenant-${tenantId}-*`,
                // Object-level permissions for clean tenant naming  
                `arn:aws:s3:::*-${props.env}-tenant-${tenantId}-*/*`,
              ],
            }),

            // DynamoDB access for tenant-specific tables (clean naming without PrincipalTag conditions)
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
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-${tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-${tenantId}/index/*`,
              ],
            }),

            // CloudWatch Logs access for debugging and monitoring
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
                `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/lambda/*:*`,
              ],
            }),

            // Bedrock access for AI functionality (tenant-agnostic)
            new PolicyStatement({
              sid: 'BedrockAccess',
              effect: Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'], // Bedrock models don't have tenant-specific ARNs
            }),

            // Polly access for text-to-speech functionality (tenant-agnostic)
            new PolicyStatement({
              sid: 'PollyAccess',
              effect: Effect.ALLOW,
              actions: ['polly:SynthesizeSpeech'],
              resources: ['*'], // Polly doesn't have tenant-specific resources
            }),

            // Explicit deny for other tenant resources to prevent cross-tenant access
            new PolicyStatement({
              sid: 'DenyOtherTenantResources',
              effect: Effect.DENY,
              actions: ['dynamodb:*', 's3:*'],
              resources: [
                // Deny access to other tenant DynamoDB tables
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*/index/*`,
                // Deny access to other tenant S3 buckets
                `arn:aws:s3:::*-tenant-*`,
                `arn:aws:s3:::*-tenant-*/*`,
              ],
              conditions: {
                StringNotLike: {
                  // Allow only this tenant's resource patterns  
                  'dynamodb:LeadingKeys': [`*-tenant-${tenantId}*`],
                },
              },
            }),
          ],
        }),
      },
    });

    return role;
  }

  /**
   * Get role for a specific tenant ID
   */
  public getRoleForTenant(tenantId: string): Role | undefined {
    return this.roles.get(tenantId);
  }

  /**
   * Get role ARN for a specific tenant ID
   */
  public getRoleArnForTenant(tenantId: string): string | undefined {
    const role = this.roles.get(tenantId);
    return role?.roleArn;
  }

  /**
   * Get all tenant role ARNs as a map
   */
  public getAllTenantRoleArns(): Map<string, string> {
    const arns = new Map<string, string>();
    this.roles.forEach((role, tenantId) => {
      arns.set(tenantId, role.roleArn);
    });
    return arns;
  }
}