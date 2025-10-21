import { Duration } from 'aws-cdk-lib';
import { IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PlanQuotaSchema } from './plan-quota-schema';
import { OpenFGAService } from '../openfga/openfga-service';
import { OpenFGADatabase } from '../openfga/openfga-database';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';

/**
 * Authorization System Props
 */
export interface AuthorizationSystemProps {
  /** Cognito User Pool for JWT verification */
  readonly userPool: IUserPool;

  /**
   * Cognito User Pool App Client ID (optional for access tokens)
   * If not provided, client ID validation will be skipped when verifying access tokens.
   * Required if verifying ID tokens.
   */
  readonly userPoolClientId?: string;

  /**
   * VPC for Lambda functions and OpenFGA service
   */
  readonly vpc: IVpc;

  /**
   * Environment name for resource naming
   */
  readonly environment: string;

  /** Enable authorization cache */
  readonly enableCache?: boolean;

  /** Cache TTL in seconds */
  readonly cacheTTLSeconds?: number;

  /**
   * Enable OpenFGA playground (for development only)
   * @default false
   */
  readonly enablePlayground?: boolean;

  /**
   * OpenFGA container image tag
   * @default 'latest'
   */
  readonly openFgaImageTag?: string;

  /**
   * Multi-AZ deployment for OpenFGA database
   * @default false
   */
  readonly multiAz?: boolean;

  /**
   * Enable deletion protection for OpenFGA database
   * @default false
   */
  readonly deletionProtection?: boolean;
}

/**
 * Authorization System Construct
 * 認可システムコンストラクト
 *
 * Creates a complete self-hosted authorization system with:
 * - Lambda Authorizer for API Gateway
 * - Self-hosted OpenFGA service (ECS Fargate + PostgreSQL RDS)
 * - PostgreSQL schema for plans and usage tracking
 */
export class AuthorizationSystem extends Construct {
  /** Lambda Authorizer function */
  public readonly authorizerFunction: NodejsFunction;

  /** Plan/quota schema in PostgreSQL */
  public readonly planQuotaSchema: PlanQuotaSchema;

  /** Self-hosted OpenFGA Service */
  public readonly openFgaService: OpenFGAService;

  /** OpenFGA PostgreSQL Database */
  public readonly openFgaDatabase: OpenFGADatabase;

  /** OpenFGA API endpoint */
  public readonly openFgaEndpoint: string;

  /** OpenFGA pre-shared keys secret */
  public readonly openFgaSecret: Secret;

  constructor(scope: Construct, id: string, props: AuthorizationSystemProps) {
    super(scope, id);

    // ========================================================================
    // OpenFGA Infrastructure (Database + Service)
    // ========================================================================

    // Create OpenFGA PostgreSQL Database
    this.openFgaDatabase = new OpenFGADatabase(this, 'OpenFGADatabase', {
      vpc: props.vpc,
      environment: props.environment,
      databaseName: 'openfga',
      multiAz: props.multiAz ?? false,
      deletionProtection: props.deletionProtection ?? false,
    });

    // Create OpenFGA ECS Fargate Service
    this.openFgaService = new OpenFGAService(this, 'OpenFGAService', {
      vpc: props.vpc,
      database: this.openFgaDatabase,
      environment: props.environment,
      imageTag: props.openFgaImageTag ?? 'latest',
      enablePlayground: props.enablePlayground ?? false,
    });

    this.openFgaEndpoint = this.openFgaService.endpoint;
    this.openFgaSecret = this.openFgaService.presharedKeysSecret;

    // ========================================================================
    // Plan/Quota PostgreSQL Schema
    // ========================================================================
    this.planQuotaSchema = new PlanQuotaSchema(this, 'PlanQuotaSchema', {
      vpc: props.vpc,
      databaseEndpoint: this.openFgaDatabase.endpoint,
      databaseName: 'openfga',
      databaseSecret: this.openFgaDatabase.secret,
      databaseSecurityGroup: this.openFgaDatabase.securityGroup,
    });

    // ========================================================================
    // Security Group for Lambda
    // ========================================================================
    const lambdaSecurityGroup = new SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for authorization Lambda functions',
      allowAllOutbound: true,
    });

    // Allow Lambda to access OpenFGA service
    this.openFgaService.securityGroup.addIngressRule(
      lambdaSecurityGroup,
      this.openFgaService.loadBalancer.connections.defaultPort!,
      'Allow Lambda authorizer to access OpenFGA'
    );

    // ========================================================================
    // Lambda Authorizer
    // ========================================================================
    const authorizerEnvironment: Record<string, string> = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      // OpenFGA Configuration
      OPENFGA_API_URL: this.openFgaEndpoint,
      OPENFGA_STORE_ID: 'default', // TODO: Store ID should be created during deployment
      OPENFGA_KEY_SECRET_ARN: this.openFgaSecret.secretArn,
      // PostgreSQL Configuration
      DB_ENDPOINT: this.openFgaDatabase.endpoint,
      DB_NAME: 'openfga',
      DB_SECRET_ARN: this.openFgaDatabase.secret.secretArn,
      // Cache settings
      CACHE_ENABLED: (props.enableCache ?? true).toString(),
      CACHE_TTL_SECONDS: (props.cacheTTLSeconds ?? 300).toString(),
    };

    // Only add client ID if provided (optional for access token verification)
    if (props.userPoolClientId) {
      authorizerEnvironment.COGNITO_CLIENT_ID = props.userPoolClientId;
    }

    this.authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/authorizer/authorization-authorizer.ts',
      handler: 'handler',
      timeout: Duration.seconds(10),
      memorySize: 512,
      vpc: props.vpc,
      securityGroups: [lambdaSecurityGroup],
      environment: authorizerEnvironment,
      bundling: {
        externalModules: ['aws-sdk'], // Exclude AWS SDK (provided by Lambda runtime)
        nodeModules: [
          '@openfga/sdk',
          'aws-jwt-verify',
          'pg',
          '@aws-sdk/client-cloudwatch',
          '@aws-sdk/client-secrets-manager',
        ],
      },
    });

    // Ensure schema is created before Lambda deployment
    this.authorizerFunction.node.addDependency(this.planQuotaSchema.customResource);

    // Allow Lambda to access database
    this.openFgaDatabase.securityGroup.addIngressRule(
      lambdaSecurityGroup,
      this.openFgaDatabase.connections.defaultPort!,
      'Allow Lambda authorizer to access database'
    );

    // Grant Secrets Manager read permissions
    this.openFgaSecret.grantRead(this.authorizerFunction);
    this.openFgaDatabase.secret.grantRead(this.authorizerFunction);

    // Grant CloudWatch metrics permission
    this.authorizerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // ========================================================================
    // OpenFGA Schema Migration
    // ========================================================================
    // NOTE: OpenFGA schema migration should be handled separately using:
    // 1. OpenFGA CLI to create store and upload authorization model
    // 2. Custom deployment script with OpenFGA API
    // 3. See docs/specs/authorization/authorization-schema.fga for the schema
    //
    // The store ID and model ID should be provided in openFgaConfig
  }
}
