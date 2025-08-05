import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface TenantIamRoleProps {
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
   * @default 'custom:tenant_id'
   */
  readonly tenantIdClaim?: string;

  /**
   * Role name
   * @default - AWS CloudFormation generates a unique name
   */
  readonly roleName?: string;

  /**
   * Description for the role
   * @default 'Role for multi-tenant access with tenant isolation'
   */
  readonly description?: string;

  /**
   * Maximum session duration
   * @default Duration.hours(1)
   */
  readonly maxSessionDuration?: cdk.Duration;
}

export class TenantIamRole extends Construct {
  /**
   * The IAM role that can be assumed by authenticated users
   */
  public readonly role: iam.Role;

  /**
   * The tenant ID claim used in policies
   */
  public readonly tenantIdClaim: string;

  /**
   * The identity provider ARN
   */
  public readonly identityProviderArn: string;

  constructor(scope: Construct, id: string, props: TenantIamRoleProps) {
    super(scope, id);

    this.tenantIdClaim = props.tenantIdClaim || 'custom:tenant_id';
    this.identityProviderArn = props.identityProviderArn;

    // Extract the domain from the identity provider ARN
    let identityProviderDomain: string;
    let federatedPrincipal: string;

    // Check if this is a Cognito Identity Pool ARN
    if (props.identityProviderArn.includes(':identitypool/')) {
      // For Cognito Identity Pool, use cognito-identity.amazonaws.com as both principal and domain
      federatedPrincipal = 'cognito-identity.amazonaws.com';
      identityProviderDomain = 'cognito-identity.amazonaws.com';
    } else if (props.identityProviderArn.includes(':userpool/')) {
      // For Cognito User Pool (shouldn't be used directly, but handle it)
      federatedPrincipal = 'cognito-identity.amazonaws.com';
      identityProviderDomain = 'cognito-identity.amazonaws.com';
    } else if (props.identityProviderArn.includes('oidc-provider/')) {
      // For OIDC providers, use the ARN as principal and extract domain
      federatedPrincipal = props.identityProviderArn;
      const arnParts = props.identityProviderArn.split('/');
      identityProviderDomain = arnParts[arnParts.length - 1];
    } else {
      // Default to using the ARN
      federatedPrincipal = props.identityProviderArn;
      identityProviderDomain = props.identityProviderArn;
    }

    // Create the IAM role with AssumeRoleWithWebIdentity trust policy
    this.role = new iam.Role(this, 'Role', {
      roleName: props.roleName,
      assumedBy: new iam.WebIdentityPrincipal(federatedPrincipal, {
        StringEquals: {
          [`${identityProviderDomain}:aud`]: props.audience,
        },
      }),
      description:
        props.description ||
        'Role for multi-tenant access with tenant isolation',
      maxSessionDuration: props.maxSessionDuration || cdk.Duration.hours(1),
    });

    // Output the role ARN
    new cdk.CfnOutput(this, 'RoleArn', {
      value: this.role.roleArn,
      description: 'ARN of the tenant access role',
    });

    new cdk.CfnOutput(this, 'RoleName', {
      value: this.role.roleName,
      description: 'Name of the tenant access role',
    });
  }

  /**
   * Add a policy statement to the role
   */
  public addToPolicy(statement: iam.PolicyStatement): void {
    this.role.addToPolicy(statement);
  }

  /**
   * Attach a managed policy to the role
   */
  public attachManagedPolicy(managedPolicy: iam.IManagedPolicy): void {
    this.role.addManagedPolicy(managedPolicy);
  }

  /**
   * Create a policy statement for DynamoDB per-tenant table access
   * This allows access to tables with naming pattern: <baseTableName>-<tenantId>
   */
  public createDynamoDbTenantTablePolicyStatement(
    baseTableName: string,
    actions?: string[]
  ): iam.PolicyStatement {
    const defaultActions = [
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
    ];

    // Allow access to table named: baseTableName-tenant-<tenantId>
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: actions || defaultActions,
      resources: [
        `arn:aws:dynamodb:*:*:table/${baseTableName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}`,
        `arn:aws:dynamodb:*:*:table/${baseTableName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}/index/*`,
      ],
    });
  }

  /**
   * Create a policy statement for S3 per-tenant bucket access
   * This allows access to buckets with naming pattern: <baseBucketName>-tenant-<tenantId>
   */
  public createS3TenantBucketPolicyStatement(
    baseBucketName: string,
    actions?: string[]
  ): iam.PolicyStatement {
    const defaultActions = [
      's3:GetObject',
      's3:PutObject',
      's3:DeleteObject',
      's3:ListBucket',
      's3:GetBucketLocation',
      's3:GetBucketVersioning',
      's3:ListBucketVersions',
      's3:ListBucketMultipartUploads',
      's3:ListMultipartUploadParts',
      's3:AbortMultipartUpload',
    ];

    // Allow access to bucket named: baseBucketName-tenant-<tenantId>
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: actions || defaultActions,
      resources: [
        `arn:aws:s3:::${baseBucketName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}`,
        `arn:aws:s3:::${baseBucketName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}/*`,
      ],
    });
  }

  /**
   * Create a policy statement for SQS per-tenant queue access
   * This allows access to queues with naming pattern: <baseQueueName>-tenant-<tenantId>
   */
  public createSqsTenantQueuePolicyStatement(
    baseQueueName: string,
    actions?: string[]
  ): iam.PolicyStatement {
    const defaultActions = [
      'sqs:SendMessage',
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ChangeMessageVisibility',
      'sqs:PurgeQueue',
    ];

    // Allow access to queue named: baseQueueName-tenant-<tenantId>
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: actions || defaultActions,
      resources: [
        `arn:aws:sqs:*:*:${baseQueueName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}`,
      ],
    });
  }

  /**
   * Create a policy statement for SNS per-tenant topic access
   * This allows access to topics with naming pattern: <baseTopicName>-tenant-<tenantId>
   */
  public createSnsTenantTopicPolicyStatement(
    baseTopicName: string,
    actions?: string[]
  ): iam.PolicyStatement {
    const defaultActions = [
      'sns:Publish',
      'sns:Subscribe',
      'sns:Unsubscribe',
      'sns:GetTopicAttributes',
      'sns:SetTopicAttributes',
      'sns:ListSubscriptionsByTopic',
    ];

    // Allow access to topic named: baseTopicName-tenant-<tenantId>
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: actions || defaultActions,
      resources: [
        `arn:aws:sns:*:*:${baseTopicName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}`,
      ],
    });
  }

  /**
   * Create a policy statement for Lambda per-tenant function access
   * This allows access to functions with naming pattern: <baseFunctionName>-tenant-<tenantId>
   */
  public createLambdaTenantFunctionPolicyStatement(
    baseFunctionName: string,
    actions?: string[]
  ): iam.PolicyStatement {
    const defaultActions = [
      'lambda:InvokeFunction',
      'lambda:InvokeAsync',
      'lambda:GetFunction',
      'lambda:GetFunctionConfiguration',
    ];

    // Allow access to function named: baseFunctionName-tenant-<tenantId>
    return new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: actions || defaultActions,
      resources: [
        `arn:aws:lambda:*:*:function:${baseFunctionName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}`,
        `arn:aws:lambda:*:*:function:${baseFunctionName}-tenant-$\{${this.identityProviderArn}:${this.tenantIdClaim}}:*`,
      ],
    });
  }
}
