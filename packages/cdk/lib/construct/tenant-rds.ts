/**
 * Tenant RDS Construct
 * Creates tenant-specific RDS PostgreSQL instance with proper VPC configuration
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface TenantRdsProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC to deploy the RDS instance into
   */
  readonly vpc: ec2.IVpc;

  /**
   * Database name
   * @default 'tenant_db'
   */
  readonly databaseName?: string;

  /**
   * Database engine version
   * @default PostgresEngineVersion.VER_15
   */
  readonly engineVersion?: rds.PostgresEngineVersion;

  /**
   * Instance type
   * @default t3.micro
   */
  readonly instanceType?: ec2.InstanceType;

  /**
   * Allocated storage in GB
   * @default 20
   */
  readonly allocatedStorage?: number;

  /**
   * Maximum allocated storage in GB (for storage autoscaling)
   * @default 100
   */
  readonly maxAllocatedStorage?: number;

  /**
   * Enable Multi-AZ deployment
   * @default false for dev, true for prod
   */
  readonly multiAz?: boolean;

  /**
   * Backup retention period in days
   * @default 7
   */
  readonly backupRetentionDays?: number;

  /**
   * Removal policy for the database
   * @default RemovalPolicy.SNAPSHOT for prod, RemovalPolicy.DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;

  /**
   * Enable deletion protection
   * @default true for prod, false for dev
   */
  readonly deletionProtection?: boolean;
}

export class TenantRds extends Construct {
  /**
   * The RDS database instance
   */
  public readonly instance: rds.DatabaseInstance;

  /**
   * The database credentials secret
   */
  public readonly secret: secretsmanager.ISecret;

  /**
   * The security group for the RDS instance
   */
  public readonly securityGroup: ec2.SecurityGroup;

  /**
   * The tenant ID
   */
  public readonly tenantId: string;

  /**
   * The database name
   */
  public readonly databaseName: string;

  constructor(scope: Construct, id: string, props: TenantRdsProps) {
    super(scope, id);

    this.tenantId = props.tenantId;

    // Validate tenant ID
    if (!this.tenantId || this.tenantId.trim() === '') {
      throw new Error('Tenant ID is required');
    }

    // Get environment
    const environment = props.environment || 'dev';

    // Sanitize tenant ID for use in resource names
    const sanitizedTenantId = this.tenantId.replace(/[^a-zA-Z0-9-]/g, '-');

    // Set database name
    this.databaseName = props.databaseName || 'tenant_db';

    // Determine removal policy based on environment
    const removalPolicy =
      props.removalPolicy ||
      (environment === 'dev'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.SNAPSHOT);

    // Determine deletion protection based on removalPolicy, not environment
    // If removalPolicy is DESTROY, disable deletion protection by default
    // Otherwise, enable deletion protection by default
    const deletionProtection =
      props.deletionProtection !== undefined
        ? props.deletionProtection
        : removalPolicy !== cdk.RemovalPolicy.DESTROY;

    // Determine Multi-AZ based on environment
    const multiAz =
      props.multiAz !== undefined
        ? props.multiAz
        : environment === 'prod';

    // Create security group for RDS instance
    this.securityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: props.vpc,
      description: `Security group for RDS instance of tenant ${this.tenantId}`,
      securityGroupName: `${environment}-${sanitizedTenantId}-rds-sg`,
    });

    // Allow inbound traffic from within the VPC on PostgreSQL port
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from within VPC'
    );

    // Create subnet group for RDS instance
    const subnetGroup = new rds.SubnetGroup(this, 'RdsSubnetGroup', {
      description: `Subnet group for RDS instance of tenant ${this.tenantId}`,
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      subnetGroupName: `${environment}-${sanitizedTenantId}-rds-subnet-group`,
    });

    // Create database credentials
    const credentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: `/tenant/${this.tenantId}/rds/credentials`,
    });

    // Create RDS instance
    this.instance = new rds.DatabaseInstance(this, 'RdsInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: props.engineVersion || rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: props.instanceType || ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      subnetGroup,
      securityGroups: [this.securityGroup],
      credentials,
      databaseName: this.databaseName,
      allocatedStorage: props.allocatedStorage || 20,
      maxAllocatedStorage: props.maxAllocatedStorage || 100,
      multiAz,
      backupRetention: cdk.Duration.days(props.backupRetentionDays || 7),
      deletionProtection,
      removalPolicy,
      instanceIdentifier: `${environment}-${sanitizedTenantId}-db`,
      // Enable encryption at rest
      storageEncrypted: true,
      // Enable automated backups
      preferredBackupWindow: '03:00-04:00', // UTC
      // Enable enhanced monitoring
      monitoringInterval: cdk.Duration.seconds(60),
      // Enable performance insights
      enablePerformanceInsights: environment !== 'dev',
      performanceInsightRetention:
        environment === 'dev'
          ? rds.PerformanceInsightRetention.DEFAULT
          : rds.PerformanceInsightRetention.LONG_TERM,
      // CloudWatch Logs exports
      cloudwatchLogsExports: ['postgresql'],
      // Auto minor version upgrade
      autoMinorVersionUpgrade: true,
    });

    // Get the generated secret
    this.secret = this.instance.secret!;

    // Add tags
    cdk.Tags.of(this.instance).add('TenantId', this.tenantId);
    cdk.Tags.of(this.instance).add('Environment', environment);
    cdk.Tags.of(this.instance).add('Purpose', 'TenantRDS');

    // ====================================================
    // SSM Parameter Store for Tenant-specific RDS Configuration
    // ====================================================
    // Store RDS configuration in SSM Parameter Store
    // This allows tenant-isolated configuration management
    const rdsEndpointParameter = new ssm.StringParameter(
      this,
      'RdsEndpointParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsEndpoint`,
        description: `RDS endpoint for tenant ${this.tenantId}`,
        stringValue: this.instance.dbInstanceEndpointAddress,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    const rdsPortParameter = new ssm.StringParameter(
      this,
      'RdsPortParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsPort`,
        description: `RDS port for tenant ${this.tenantId}`,
        stringValue: this.instance.dbInstanceEndpointPort,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    const rdsDatabaseParameter = new ssm.StringParameter(
      this,
      'RdsDatabaseParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsDatabase`,
        description: `RDS database name for tenant ${this.tenantId}`,
        stringValue: this.databaseName,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    const rdsRegionParameter = new ssm.StringParameter(
      this,
      'RdsRegionParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsRegion`,
        description: `RDS region for tenant ${this.tenantId}`,
        stringValue: cdk.Stack.of(this).region,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    const rdsSecretArnParameter = new ssm.StringParameter(
      this,
      'RdsSecretArnParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsSecretArn`,
        description: `RDS credentials secret ARN for tenant ${this.tenantId}`,
        stringValue: this.secret.secretArn,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    const rdsUsernameParameter = new ssm.StringParameter(
      this,
      'RdsUsernameParameter',
      {
        parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsUsername`,
        description: `RDS username for tenant ${this.tenantId}`,
        stringValue: 'postgres',
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // Ensure parameters are created after RDS instance is available
    rdsEndpointParameter.node.addDependency(this.instance);
    rdsPortParameter.node.addDependency(this.instance);

    // Outputs
    new cdk.CfnOutput(this, 'RdsEndpoint', {
      value: this.instance.dbInstanceEndpointAddress,
      description: `RDS endpoint for tenant ${this.tenantId}`,
    });

    new cdk.CfnOutput(this, 'RdsPort', {
      value: this.instance.dbInstanceEndpointPort,
      description: `RDS port for tenant ${this.tenantId}`,
    });

    new cdk.CfnOutput(this, 'RdsSecretArn', {
      value: this.secret.secretArn,
      description: `RDS credentials secret ARN for tenant ${this.tenantId}`,
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: this.databaseName,
      description: `Database name for tenant ${this.tenantId}`,
    });
  }

  /**
   * Grant access to the RDS instance from a security group
   */
  public grantAccess(securityGroup: ec2.ISecurityGroup): void {
    this.securityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda'
    );
  }

  /**
   * Grant secret read permissions to a role or user
   */
  public grantSecretRead(grantable: cdk.aws_iam.IGrantable): void {
    this.secret.grantRead(grantable);
  }
}
