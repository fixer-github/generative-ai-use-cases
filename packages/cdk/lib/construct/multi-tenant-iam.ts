import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MultiTenantIamProps {
  /**
   * The identity provider ARN (e.g., OIDC provider ARN)
   */
  readonly identityProviderArn: string;

  /**
   * The audience/client ID for the identity provider
   */
  readonly audience: string;

  /**
   * The tenant identifier claim in the JWT token
   */
  readonly tenantIdClaim?: string;

  /**
   * DynamoDB tables that tenants need access to
   */
  readonly tenantTables?: dynamodb.Table[];

  /**
   * S3 buckets that tenants need access to
   */
  readonly tenantBuckets?: s3.Bucket[];

  /**
   * Additional resource ARNs that tenants need access to
   */
  readonly additionalResourceArns?: string[];

  /**
   * Tags to apply to the IAM roles
   */
  readonly tags?: { [key: string]: string };
}

export class MultiTenantIam extends Construct {
  /**
   * The IAM role that can be assumed by authenticated users
   */
  public readonly tenantRole: iam.Role;

  /**
   * Policy that grants access to tenant-specific resources
   */
  public readonly tenantPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: MultiTenantIamProps) {
    super(scope, id);

    const tenantIdClaim = props.tenantIdClaim || 'custom:tenant_id';

    // Create the trust policy for AssumeRoleWithWebIdentity
    const trustPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.FederatedPrincipal(props.identityProviderArn, {
            'StringEquals': {
              [`${props.identityProviderArn}:aud`]: props.audience,
            },
          }, 'sts:AssumeRoleWithWebIdentity')],
          actions: ['sts:AssumeRoleWithWebIdentity'],
        }),
      ],
    });

    // Create the IAM role
    this.tenantRole = new iam.Role(this, 'TenantRole', {
      assumedBy: new iam.WebIdentityPrincipal(props.identityProviderArn, {
        'StringEquals': {
          [`${props.identityProviderArn}:aud`]: props.audience,
        },
      }),
      description: 'Role for multi-tenant access with tenant isolation',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Create policy statements for tenant-specific access
    const policyStatements: iam.PolicyStatement[] = [];

    // DynamoDB access with tenant isolation
    if (props.tenantTables && props.tenantTables.length > 0) {
      props.tenantTables.forEach((table) => {
        // Allow operations on items where the partition key matches the tenant ID
        policyStatements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:BatchGetItem',
              'dynamodb:BatchWriteItem',
            ],
            resources: [
              table.tableArn,
              `${table.tableArn}/index/*`,
            ],
            conditions: {
              'ForAllValues:StringEquals': {
                'dynamodb:LeadingKeys': [`$\{${props.identityProviderArn}:${tenantIdClaim}}`],
              },
            },
          })
        );

        // Allow DescribeTable for table metadata
        policyStatements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:DescribeTable'],
            resources: [table.tableArn],
          })
        );
      });
    }

    // S3 access with tenant isolation
    if (props.tenantBuckets && props.tenantBuckets.length > 0) {
      props.tenantBuckets.forEach((bucket) => {
        // List objects in tenant-specific prefix
        policyStatements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:ListBucket'],
            resources: [bucket.bucketArn],
            conditions: {
              'StringLike': {
                's3:prefix': [`tenants/$\{${props.identityProviderArn}:${tenantIdClaim}}/*`],
              },
            },
          })
        );

        // CRUD operations on tenant-specific objects
        policyStatements.push(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
              's3:GetObjectVersion',
              's3:GetObjectTagging',
              's3:PutObjectTagging',
            ],
            resources: [`${bucket.bucketArn}/tenants/$\{${props.identityProviderArn}:${tenantIdClaim}}/*`],
          })
        );
      });
    }

    // Additional resource access
    if (props.additionalResourceArns && props.additionalResourceArns.length > 0) {
      policyStatements.push(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['*'],
          resources: props.additionalResourceArns,
          conditions: {
            'StringEquals': {
              'aws:userid': [`$\{${props.identityProviderArn}:${tenantIdClaim}}`],
            },
          },
        })
      );
    }

    // Create managed policy
    this.tenantPolicy = new iam.ManagedPolicy(this, 'TenantPolicy', {
      description: 'Policy for tenant-specific resource access',
      statements: policyStatements,
      roles: [this.tenantRole],
    });

    // Apply tags if provided
    if (props.tags) {
      Object.entries(props.tags).forEach(([key, value]) => {
        cdk.Tags.of(this.tenantRole).add(key, value);
        cdk.Tags.of(this.tenantPolicy).add(key, value);
      });
    }

    // Output the role ARN
    new cdk.CfnOutput(this, 'TenantRoleArn', {
      value: this.tenantRole.roleArn,
      description: 'ARN of the tenant access role',
    });
  }

  /**
   * Grant additional permissions to the tenant role
   */
  public grantAdditionalPermissions(statement: iam.PolicyStatement): void {
    this.tenantRole.addToPolicy(statement);
  }

  /**
   * Create a session policy document for additional runtime restrictions
   */
  public static createSessionPolicy(tenantId: string, resourceArns: string[]): string {
    const sessionPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: '*',
          Resource: resourceArns,
          Condition: {
            StringEquals: {
              'aws:userid': tenantId,
            },
          },
        },
      ],
    };
    return JSON.stringify(sessionPolicy);
  }
}