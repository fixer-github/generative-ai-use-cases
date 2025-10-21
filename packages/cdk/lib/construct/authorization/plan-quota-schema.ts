import { Duration, CustomResource } from 'aws-cdk-lib';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { IVpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Plan Quota Schema Props
 */
export interface PlanQuotaSchemaProps {
  /**
   * VPC where the database is located
   */
  readonly vpc: IVpc;

  /**
   * Database endpoint (host:port)
   */
  readonly databaseEndpoint: string;

  /**
   * Database name
   */
  readonly databaseName: string;

  /**
   * Secret containing database credentials
   * Must have keys: username, password
   */
  readonly databaseSecret: ISecret;

  /**
   * Security group for database access
   */
  readonly databaseSecurityGroup: SecurityGroup;
}

/**
 * Plan Quota Schema Construct
 * プラン・クォータスキーマコンストラクト
 *
 * Creates the PostgreSQL schema for plan, tenant, and usage data using a Custom Resource.
 * This runs SQL migrations to create tables, indexes, and seed initial data.
 */
export class PlanQuotaSchema extends Construct {
  /** Custom resource for schema setup */
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: PlanQuotaSchemaProps) {
    super(scope, id);

    // Read SQL migration file
    const sqlMigration = readFileSync(
      join(__dirname, '../../../lambda/migrations/plan-schema.sql'),
      'utf-8'
    );

    // Create security group for Lambda
    const lambdaSecurityGroup = new SecurityGroup(
      this,
      'MigrationLambdaSecurityGroup',
      {
        vpc: props.vpc,
        description: 'Security group for plan schema migration Lambda',
        allowAllOutbound: true,
      }
    );

    // Allow Lambda to access database
    props.databaseSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      props.databaseSecurityGroup.connections.defaultPort!,
      'Allow migration Lambda to access database'
    );

    // Create Lambda function for migration
    const migrationFunction = new NodejsFunction(this, 'MigrationFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_ENDPOINT: props.databaseEndpoint,
        DB_NAME: props.databaseName,
        DB_SECRET_ARN: props.databaseSecret.secretArn,
        SQL_MIGRATION: sqlMigration,
      },
      bundling: {
        externalModules: ['aws-sdk'],
        nodeModules: ['pg'],
      },
      entry: join(__dirname, '../../../lambda/migrations/migrate-plan-schema.ts'),
    });

    // Grant permissions to read secret
    props.databaseSecret.grantRead(migrationFunction);

    // Create Custom Resource provider
    const provider = new Provider(this, 'MigrationProvider', {
      onEventHandler: migrationFunction,
    });

    // Create Custom Resource
    this.customResource = new CustomResource(this, 'MigrationResource', {
      serviceToken: provider.serviceToken,
      properties: {
        // Force update on SQL changes by including hash
        SqlHash: this.hashString(sqlMigration),
        Timestamp: Date.now(),
      },
    });
  }

  /**
   * Simple hash function for SQL content
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }
}
