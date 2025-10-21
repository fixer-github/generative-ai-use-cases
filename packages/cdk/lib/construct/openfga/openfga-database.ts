import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { IVpc, InstanceType, InstanceClass, InstanceSize, SubnetType, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
  Credentials,
} from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Properties for OpenFGA Database
 */
export interface OpenFGADatabaseProps {
  /**
   * VPC to deploy the database in
   */
  readonly vpc: IVpc;

  /**
   * Database name
   * @default 'openfga'
   */
  readonly databaseName?: string;

  /**
   * Instance type for RDS
   * @default db.t4g.micro
   */
  readonly instanceType?: InstanceType;

  /**
   * Enable Multi-AZ deployment
   * @default false (POC), true (production)
   */
  readonly multiAz?: boolean;

  /**
   * Allocated storage in GB
   * @default 20
   */
  readonly allocatedStorageGb?: number;

  /**
   * Backup retention period in days
   * @default 7
   */
  readonly backupRetentionDays?: number;

  /**
   * Enable deletion protection
   * @default false (POC), true (production)
   */
  readonly deletionProtection?: boolean;

  /**
   * Environment name for resource naming
   */
  readonly environment: string;
}

/**
 * OpenFGA PostgreSQL Database Construct
 *
 * Creates an RDS PostgreSQL database for OpenFGA with:
 * - Automated backups
 * - Encryption at rest
 * - Secrets Manager for credentials
 * - Security group with restricted access
 */
export class OpenFGADatabase extends Construct {
  /**
   * The RDS database instance
   */
  public readonly instance: DatabaseInstance;

  /**
   * Security group for the database
   */
  public readonly securityGroup: SecurityGroup;

  /**
   * Secret containing database credentials
   */
  public readonly credentialsSecret: Secret;

  /**
   * Database connection string (without password)
   */
  public readonly connectionString: string;

  constructor(scope: Construct, id: string, props: OpenFGADatabaseProps) {
    super(scope, id);

    const databaseName = props.databaseName ?? 'openfga';
    const environment = props.environment;

    // Create security group for database
    this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `Security group for OpenFGA database (${environment})`,
      allowAllOutbound: false,
    });

    // Create credentials in Secrets Manager
    this.credentialsSecret = new Secret(this, 'Credentials', {
      secretName: `/openfga/${environment}/db-credentials`,
      description: `Database credentials for OpenFGA (${environment})`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'openfga' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Create RDS PostgreSQL instance
    this.instance = new DatabaseInstance(this, 'Instance', {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_15_4, // OpenFGA supports Postgres 13+
      }),
      instanceType: props.instanceType ?? InstanceType.of(
        InstanceClass.T4G,
        InstanceSize.MICRO,
      ),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.securityGroup],
      databaseName,
      credentials: Credentials.fromSecret(this.credentialsSecret),

      // Storage configuration
      allocatedStorage: props.allocatedStorageGb ?? 20,
      maxAllocatedStorage: (props.allocatedStorageGb ?? 20) * 2, // Auto-scale up to 2x
      storageType: StorageType.GP3,
      storageEncrypted: true,

      // High availability
      multiAz: props.multiAz ?? false,

      // Backup configuration
      backupRetention: Duration.days(props.backupRetentionDays ?? 7),
      preferredBackupWindow: '03:00-04:00', // UTC
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00', // UTC

      // Deletion protection
      deletionProtection: props.deletionProtection ?? false,
      removalPolicy: props.deletionProtection
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.SNAPSHOT,

      // Performance insights
      enablePerformanceInsights: true,
      performanceInsightRetention: 7,

      // Enhanced monitoring
      monitoringInterval: Duration.seconds(60),

      // CloudWatch logs
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: 7,

      // Auto minor version upgrade
      autoMinorVersionUpgrade: true,

      // Parameter group optimizations for OpenFGA
      parameters: {
        // Connection pooling
        max_connections: '100',

        // Performance tuning
        shared_buffers: '256MB',
        effective_cache_size: '768MB',
        work_mem: '4MB',
        maintenance_work_mem: '64MB',

        // Logging for debugging (reduce in production)
        log_min_duration_statement: '1000', // Log queries > 1s
        log_statement: 'ddl', // Log DDL statements
      },
    });

    // Build connection string (password will be retrieved from secret)
    const username = 'openfga';
    const host = this.instance.dbInstanceEndpointAddress;
    const port = this.instance.dbInstanceEndpointPort;

    this.connectionString = `postgres://${username}:PASSWORD@${host}:${port}/${databaseName}?sslmode=require`;
  }

  /**
   * Allow connections from a security group
   */
  allowConnectionFrom(securityGroup: SecurityGroup, description?: string) {
    this.securityGroup.addIngressRule(
      securityGroup,
      this.instance.connections.defaultPort!,
      description ?? 'Allow OpenFGA service access',
    );
  }

  /**
   * Get database connection configuration for ECS task
   */
  getConnectionConfig() {
    return {
      host: this.instance.dbInstanceEndpointAddress,
      port: this.instance.dbInstanceEndpointPort,
      database: this.instance.instanceIdentifier,
      username: 'openfga',
      secretArn: this.credentialsSecret.secretArn,
    };
  }
}
