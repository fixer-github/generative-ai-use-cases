import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { MultiTenantIam } from './construct/multi-tenant-iam';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface MultiTenantIamStackProps extends cdk.StackProps {
  /**
   * The Cognito user pool ID
   */
  readonly userPoolId?: string;

  /**
   * The identity provider name (e.g., 'cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX')
   */
  readonly identityProviderName?: string;

  /**
   * The audience/client ID
   */
  readonly audience?: string;
}

export class MultiTenantIamStack extends cdk.Stack {
  public readonly tenantDataTable: dynamodb.Table;
  public readonly tenantFilesBucket: s3.Bucket;
  public readonly multiTenantIam: MultiTenantIam;

  constructor(scope: Construct, id: string, props?: MultiTenantIamStackProps) {
    super(scope, id, props);

    // Create a DynamoDB table for tenant data
    this.tenantDataTable = new dynamodb.Table(this, 'TenantDataTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'dataId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY, // For demo purposes
    });

    // Add GSI for additional query patterns
    this.tenantDataTable.addGlobalSecondaryIndex({
      indexName: 'dataTypeIndex',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'dataType',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Create an S3 bucket for tenant files
    this.tenantFilesBucket = new s3.Bucket(this, 'TenantFilesBucket', {
      bucketName: `tenant-files-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, // For demo purposes
      autoDeleteObjects: true, // For demo purposes
    });

    // Create OIDC provider ARN (example for Cognito)
    const identityProviderArn = props?.identityProviderName
      ? `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`
      : new cdk.CfnParameter(this, 'IdentityProviderArn', {
          description: 'ARN of the identity provider (e.g., Cognito User Pool ARN)',
          type: 'String',
        }).valueAsString;

    const audience = props?.audience || new cdk.CfnParameter(this, 'Audience', {
      description: 'Audience/Client ID for the identity provider',
      type: 'String',
    }).valueAsString;

    // Create the multi-tenant IAM construct
    this.multiTenantIam = new MultiTenantIam(this, 'MultiTenantIam', {
      identityProviderArn,
      audience,
      tenantIdClaim: 'custom:tenant_id',
      tenantTables: [this.tenantDataTable],
      tenantBuckets: [this.tenantFilesBucket],
      tags: {
        Purpose: 'MultiTenantDataAccess',
        ManagedBy: 'CDK',
      },
    });

    // Grant additional permissions for specific services if needed
    this.multiTenantIam.grantAdditionalPermissions(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/multi-tenant/*`],
      })
    );

    // Output important values
    new cdk.CfnOutput(this, 'TenantTableName', {
      value: this.tenantDataTable.tableName,
      description: 'Name of the tenant data table',
    });

    new cdk.CfnOutput(this, 'TenantBucketName', {
      value: this.tenantFilesBucket.bucketName,
      description: 'Name of the tenant files bucket',
    });

    new cdk.CfnOutput(this, 'TenantRoleArn', {
      value: this.multiTenantIam.tenantRole.roleArn,
      description: 'ARN of the tenant access role',
    });

    // Stack description
    this.templateOptions.description = 'Multi-tenant IAM stack with AssumeRoleWithWebIdentity for tenant-isolated data access';
  }
}