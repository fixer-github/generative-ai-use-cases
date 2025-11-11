/**
 * Tenant RDS Stack
 * Creates tenant-specific RDS PostgreSQL instance and runs database migrations
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { TenantRds } from '../../construct/tenant-rds';
import * as path from 'path';

export interface TenantRdsStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC ID to deploy the RDS instance into
   * If not provided, will look up VPC by tenant ID
   */
  readonly vpcId?: string;

  /**
   * Database name
   * @default 'tenant_db'
   */
  readonly databaseName?: string;

  /**
   * Instance type
   * @default t3.micro
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * Description for the stack
   * @default 'RDS database for tenant {tenantId}'
   */
  readonly description?: string;

  /**
   * Removal policy for resources
   * @default RemovalPolicy.SNAPSHOT for prod, RemovalPolicy.DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Stack for creating tenant-specific RDS database
 */
export class TenantRdsStack extends cdk.Stack {
  /**
   * The tenant RDS construct
   */
  private readonly tenantRds: TenantRds;

  /**
   * The migration Lambda function
   */
  private readonly migrationFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: TenantRdsStackProps) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description: 'The tenant identifier for the RDS database',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props.environment!;

    // Look up VPC
    const vpc = props.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId })
      : ec2.Vpc.fromLookup(this, 'Vpc', {
          tags: {
            TenantId: tenantId.toString(),
            Environment: environment,
          },
        });

    // Create the tenant RDS construct
    this.tenantRds = new TenantRds(this, 'TenantRds', {
      tenantId: tenantId.toString(),
      environment,
      vpc,
      databaseName: props.databaseName,
      instanceType: props.instanceType,
      removalPolicy: props.removalPolicy,
    });

    // Create security group for migration Lambda
    const migrationLambdaSg = new ec2.SecurityGroup(
      this,
      'MigrationLambdaSg',
      {
        vpc,
        description: 'Security group for database migration Lambda',
        securityGroupName: `${environment}-${tenantId}-migration-lambda-sg`,
      }
    );

    // Allow migration Lambda to access RDS
    this.tenantRds.grantAccess(migrationLambdaSg);

    // Create Lambda function for database migration
    this.migrationFunction = new lambda.Function(this, 'MigrationFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'applyMigrations.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../lambda/database-migration')
      ),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [migrationLambdaSg],
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      description: `Database migration function for tenant ${tenantId}`,
    });

    // Grant Lambda permission to read RDS credentials secret
    this.tenantRds.grantSecretRead(this.migrationFunction);

    // Grant Lambda permission to access Secrets Manager
    this.migrationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [this.tenantRds.secret.secretArn],
      })
    );

    // Create custom resource provider
    const migrationProvider = new customResources.Provider(
      this,
      'MigrationProvider',
      {
        onEventHandler: this.migrationFunction,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    // Create custom resource to run migrations
    const migrationResource = new cdk.CustomResource(
      this,
      'MigrationResource',
      {
        serviceToken: migrationProvider.serviceToken,
        properties: {
          RdsSecretArn: this.tenantRds.secret.secretArn,
          // Trigger migration on every deployment
          Timestamp: Date.now(),
        },
      }
    );

    // Ensure migration runs after RDS instance is ready
    migrationResource.node.addDependency(this.tenantRds.instance);

    // Add stack-level outputs with export names
    new cdk.CfnOutput(this, 'StackRdsEndpoint', {
      value: this.tenantRds.instance.dbInstanceEndpointAddress,
      description: `RDS endpoint for tenant ${tenantId}`,
      exportName: `${this.stackName}-RdsEndpoint`,
    });

    new cdk.CfnOutput(this, 'StackRdsPort', {
      value: this.tenantRds.instance.dbInstanceEndpointPort,
      description: `RDS port for tenant ${tenantId}`,
      exportName: `${this.stackName}-RdsPort`,
    });

    new cdk.CfnOutput(this, 'StackRdsSecretArn', {
      value: this.tenantRds.secret.secretArn,
      description: `RDS credentials secret ARN for tenant ${tenantId}`,
      exportName: `${this.stackName}-RdsSecretArn`,
    });

    new cdk.CfnOutput(this, 'StackDatabaseName', {
      value: this.tenantRds.databaseName,
      description: `Database name for tenant ${tenantId}`,
      exportName: `${this.stackName}-DatabaseName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantRDS');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      'Creates tenant-specific RDS PostgreSQL database for multi-tenant application';
  }

  /**
   * Get the RDS instance
   */
  public getRdsInstance() {
    return this.tenantRds.instance;
  }

  /**
   * Get the RDS credentials secret
   */
  public getRdsSecret() {
    return this.tenantRds.secret;
  }

  /**
   * Get the RDS security group
   */
  public getRdsSecurityGroup() {
    return this.tenantRds.securityGroup;
  }
}
