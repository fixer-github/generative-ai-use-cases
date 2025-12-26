import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  FederatedPrincipal,
  PolicyDocument,
  CompositePrincipal,
  ArnPrincipal,
  AccountPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Tags } from 'aws-cdk-lib';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { IIdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

export interface TenantRoleProps {
  readonly tenantId: string;
  readonly userPool: IUserPool;
  readonly identityPool: IIdentityPool;
  readonly userPoolClientId: string;
  readonly region: string;
  readonly account: string;
  readonly env: string;
  /**
   * Optional: ARN of the control plane Lambda execution role
   * Required for cross-account background job access
   */
  readonly controlPlaneLambdaRoleArn?: string;
  /**
   * Optional: AWS Account ID of the control plane (main stack)
   * When provided, allows all Lambda roles from this account matching
   * the naming pattern to assume this tenant role.
   * This is useful for cross-account deployments where multiple Lambda
   * functions (billing, orchestration, etc.) need to access tenant resources.
   */
  readonly controlPlaneAccountId?: string;
}

/**
 * Creates a single tenant-specific IAM role for AssumeRoleWithWebIdentity authentication
 * Supports both same-account and cross-account deployment scenarios
 * This construct is designed to be used within tenant-specific stacks
 */
export class TenantRole extends Construct {
  readonly role: Role;
  readonly tenantId: string;

  constructor(scope: Construct, id: string, props: TenantRoleProps) {
    super(scope, id);

    this.tenantId = props.tenantId;

    // Build trust policy
    const cognitoFederatedPrincipal = new FederatedPrincipal(
      'cognito-identity.amazonaws.com',
      {
        StringEquals: {
          'cognito-identity.amazonaws.com:aud':
            props.identityPool.identityPoolId,
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'authenticated',
        },
      },
      'sts:AssumeRoleWithWebIdentity'
    );

    // Build cross-account trust principals
    const crossAccountPrincipals: (ArnPrincipal | AccountPrincipal)[] = [];

    // Add specific Lambda role ARN if provided
    if (props.controlPlaneLambdaRoleArn) {
      crossAccountPrincipals.push(
        new ArnPrincipal(props.controlPlaneLambdaRoleArn)
      );
    }

    // Add control plane account trust if provided
    // This allows Lambda roles from the control plane account to assume this role
    if (props.controlPlaneAccountId) {
      crossAccountPrincipals.push(
        new AccountPrincipal(props.controlPlaneAccountId)
      );
    }

    // For cross-account deployments, also trust control plane Lambda roles for background jobs
    const assumedBy =
      crossAccountPrincipals.length > 0
        ? new CompositePrincipal(
            cognitoFederatedPrincipal,
            ...crossAccountPrincipals
          )
        : cognitoFederatedPrincipal;

    // Create tenant-specific IAM role
    this.role = new Role(this, `TenantRole`, {
      roleName: `TenantRole-${props.tenantId}`,
      description: `IAM role for tenant ${props.tenantId} - supports both same-account and cross-account access`,
      assumedBy,
      inlinePolicies: {
        TenantResourceAccess: new PolicyDocument({
          statements: [
            // S3 access for tenant-specific buckets
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
                `arn:aws:s3:::*-${props.env}-tenant-${props.tenantId}-*`,
                // Object-level permissions for clean tenant naming
                `arn:aws:s3:::*-${props.env}-tenant-${props.tenantId}-*/*`,
              ],
            }),

            // DynamoDB access for tenant-specific tables
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
                // Standard tenant tables pattern (chat, etc.)
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*${props.env}-tenant-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/*${props.env}-tenant-${props.tenantId}/index/*`,
                // PPTx tables pattern (pptx-templates-{env}-{tenantId}, pptx-generations-{env}-{tenantId})
                `arn:aws:dynamodb:${props.region}:${props.account}:table/pptx-templates-${props.env}-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/pptx-templates-${props.env}-${props.tenantId}/index/*`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/pptx-generations-${props.env}-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/pptx-generations-${props.env}-${props.tenantId}/index/*`,
                // Orchestration tables pattern ({tenantId}-orchestration-*, {tenantId}-flow-*)
                `arn:aws:dynamodb:${props.region}:${props.account}:table/${props.tenantId}-orchestration-idempotency`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/${props.tenantId}-flow-execution-history`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/${props.tenantId}-flow-execution-history/index/*`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/${props.tenantId}-flow-step-execution-history`,
                // UserStripeMapping table pattern (UserStripeMapping-{env}-tenant-{tenantId})
                `arn:aws:dynamodb:${props.region}:${props.account}:table/UserStripeMapping-${props.env}-tenant-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/UserStripeMapping-${props.env}-tenant-${props.tenantId}/index/*`,
                // Authorization tables pattern (AuthUsageEvent-{env}-tenant-{tenantId}, AuthPermissionGrant-{env}-tenant-{tenantId})
                `arn:aws:dynamodb:${props.region}:${props.account}:table/AuthUsageEvent-${props.env}-tenant-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/AuthUsageEvent-${props.env}-tenant-${props.tenantId}/index/*`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/AuthPermissionGrant-${props.env}-tenant-${props.tenantId}`,
                `arn:aws:dynamodb:${props.region}:${props.account}:table/AuthPermissionGrant-${props.env}-tenant-${props.tenantId}/index/*`,
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

            // Lambda invoke access for tenant-specific functions
            new PolicyStatement({
              sid: 'LambdaInvokeTenantFunctions',
              effect: Effect.ALLOW,
              actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
              resources: [
                // Allow invoking tenant-specific Lambda functions
                `arn:aws:lambda:${props.region}:${props.account}:function:*`,
              ],
            }),

            // Lambda invoke access for VPC-internal data access functions
            // These functions provide data access to tenant-specific RDS databases
            new PolicyStatement({
              sid: 'LambdaInvokeDataAccessFunctions',
              effect: Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                // Plan data access function (VPC内)
                `arn:aws:lambda:${props.region}:${props.account}:function:${props.env}-${props.tenantId}-plan-data-access`,
                // Subscription data access function (VPC内)
                `arn:aws:lambda:${props.region}:${props.account}:function:${props.env}-${props.tenantId}-subscription-data-access`,
                // User plan application data access function (VPC内)
                `arn:aws:lambda:${props.region}:${props.account}:function:${props.env}-${props.tenantId}-user-plan-application-data-access`,
              ],
            }),

            // Transcribe access for audio transcription functionality (tenant-agnostic)
            new PolicyStatement({
              sid: 'TranscribeAccess',
              effect: Effect.ALLOW,
              actions: [
                'transcribe:StartTranscriptionJob',
                'transcribe:GetTranscriptionJob',
                'transcribe:ListTranscriptionJobs',
                'transcribe:DeleteTranscriptionJob',
                'transcribe:TagResource',
              ],
              resources: ['*'], // Transcribe doesn't have tenant-specific resources
            }),

            // API Gateway access for OpenFGA authorization system
            new PolicyStatement({
              sid: 'ApiGatewayInvokeAccess',
              effect: Effect.ALLOW,
              actions: ['execute-api:Invoke'],
              resources: [
                // Allow invoking API Gateway endpoints in this tenant account
                // This is required for OpenFGA authorization checks via API Gateway
                `arn:aws:execute-api:${props.region}:${props.account}:*`,
              ],
            }),

            // SSM Parameter Store access for tenant configuration (RDS, OpenFGA, etc.)
            new PolicyStatement({
              sid: 'SSMParameterAccess',
              effect: Effect.ALLOW,
              actions: ['ssm:GetParameter'],
              resources: [
                // Allow reading tenant-specific configuration parameters
                `arn:aws:ssm:${props.region}:${props.account}:parameter/genu-gaixer/tenants/${props.tenantId}/*`,
              ],
            }),

            // RDS IAM authentication for tenant-specific databases
            new PolicyStatement({
              sid: 'RDSIAMAuth',
              effect: Effect.ALLOW,
              actions: ['rds-db:connect'],
              resources: [
                // Allow RDS IAM authentication for tenant-specific database users
                `arn:aws:rds-db:${props.region}:${props.account}:dbuser:*/*`,
              ],
            }),

            // Secrets Manager access for tenant-specific secrets (e.g., Stripe API keys)
            new PolicyStatement({
              sid: 'SecretsManagerTenantAccess',
              effect: Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                // Allow reading tenant-specific billing secrets
                `arn:aws:secretsmanager:${props.region}:${props.account}:secret:${props.tenantId}/billing/*`,
              ],
            }),
          ],
        }),
      },
    });

    // Add tags to the role
    Tags.of(this.role).add('TenantId', props.tenantId);
    Tags.of(this.role).add('Purpose', 'TenantIAMRole');
    if (props.env) {
      Tags.of(this.role).add('Environment', props.env);
    }
  }

  /**
   * Get the role ARN
   */
  public getRoleArn(): string {
    return this.role.roleArn;
  }

  /**
   * Get the role name
   */
  public getRoleName(): string {
    return this.role.roleName;
  }
}
