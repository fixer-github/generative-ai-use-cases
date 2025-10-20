import { Duration } from 'aws-cdk-lib';
import { IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { PlanQuotaStore } from './plan-quota-store';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

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

  /** SpiceDB endpoint (e.g., spicedb.cluster.local:50051) */
  readonly spiceDBEndpoint: string;

  /** SpiceDB authentication token (from Secrets Manager) */
  readonly spiceDBToken: string;

  /** VPC for Lambda functions (to access SpiceDB in EKS) */
  readonly vpc: IVpc;

  /** Email for quota alerts (optional) */
  readonly quotaAlertEmail?: string;

  /** Enable authorization cache */
  readonly enableCache?: boolean;

  /** Cache TTL in seconds */
  readonly cacheTTLSeconds?: number;

  /** Enable quota alerts */
  readonly enableQuotaAlerts?: boolean;
}

/**
 * Authorization System Construct
 * 認可システムコンストラクト
 *
 * Creates a complete authorization system with:
 * - Lambda Authorizer for API Gateway
 * - Usage Tracker for quota management
 * - Schema Migration Lambda for SpiceDB schema deployment
 * - DynamoDB tables for plans and usage
 * - SNS topic for quota alerts
 * - EventBridge rules for usage tracking
 */
export class AuthorizationSystem extends Construct {
  /** Lambda Authorizer function */
  public readonly authorizerFunction: NodejsFunction;

  /** Usage Tracker function */
  public readonly usageTrackerFunction: NodejsFunction;

  /** Schema Migration function */
  public readonly schemaMigrationFunction: NodejsFunction;

  /** DynamoDB tables for plans and usage */
  public readonly planQuotaStore: PlanQuotaStore;

  /** SNS topic for quota alerts */
  public readonly quotaAlertTopic: Topic;

  constructor(scope: Construct, id: string, props: AuthorizationSystemProps) {
    super(scope, id);

    // ========================================================================
    // DynamoDB Tables
    // ========================================================================
    this.planQuotaStore = new PlanQuotaStore(this, 'PlanQuotaStore', {
      pointInTimeRecovery: true,
      stream: false,
      ttlAttributeName: 'ttl',
    });

    // ========================================================================
    // SNS Topic for Quota Alerts
    // ========================================================================
    this.quotaAlertTopic = new Topic(this, 'QuotaAlertTopic', {
      displayName: 'Authorization Quota Alerts',
      topicName: 'authorization-quota-alerts',
    });

    // Add email subscription if provided
    if (props.quotaAlertEmail) {
      this.quotaAlertTopic.addSubscription(
        new EmailSubscription(props.quotaAlertEmail)
      );
    }

    // ========================================================================
    // Security Group for Lambda (to access SpiceDB in EKS)
    // ========================================================================
    const lambdaSecurityGroup = new SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for authorization Lambda functions',
      allowAllOutbound: true,
    });

    // ========================================================================
    // Lambda Authorizer
    // ========================================================================
    const authorizerEnvironment: Record<string, string> = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      SPICEDB_ENDPOINT: props.spiceDBEndpoint,
      SPICEDB_TOKEN: props.spiceDBToken,
      DYNAMODB_PLAN_TABLE: this.planQuotaStore.plansTable.tableName,
      DYNAMODB_TENANT_PLAN_TABLE:
        this.planQuotaStore.tenantPlansTable.tableName,
      DYNAMODB_USAGE_TABLE: this.planQuotaStore.usageTable.tableName,
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
          '@authzed/authzed-node',
          'aws-jwt-verify',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-cloudwatch',
        ],
      },
    });

    // Grant permissions
    this.planQuotaStore.grantPlansRead(this.authorizerFunction);

    // Grant CloudWatch metrics permission
    this.authorizerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // ========================================================================
    // Usage Tracker Lambda
    // ========================================================================
    this.usageTrackerFunction = new NodejsFunction(
      this,
      'UsageTrackerFunction',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/usage-tracker/track-usage.ts',
        handler: 'handler',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          DYNAMODB_PLAN_TABLE: this.planQuotaStore.plansTable.tableName,
          DYNAMODB_USAGE_TABLE: this.planQuotaStore.usageTable.tableName,
          QUOTA_ALERT_TOPIC_ARN: this.quotaAlertTopic.topicArn,
          ENABLE_QUOTA_ALERTS: (props.enableQuotaAlerts ?? true).toString(),
        },
        bundling: {
          externalModules: ['aws-sdk'],
          nodeModules: [
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/lib-dynamodb',
            '@aws-sdk/client-sns',
            '@aws-sdk/client-cloudwatch',
          ],
        },
      }
    );

    // Grant permissions
    this.planQuotaStore.grantUsageTracking(this.usageTrackerFunction);
    this.quotaAlertTopic.grantPublish(this.usageTrackerFunction);

    // Grant CloudWatch metrics permission
    this.usageTrackerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // ========================================================================
    // Schema Migration Lambda
    // ========================================================================
    this.schemaMigrationFunction = new NodejsFunction(
      this,
      'SchemaMigrationFunction',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/schema-migration/apply-schema.ts',
        handler: 'handler',
        timeout: Duration.seconds(60),
        memorySize: 256,
        vpc: props.vpc,
        securityGroups: [lambdaSecurityGroup],
        environment: {
          SPICEDB_ENDPOINT: props.spiceDBEndpoint,
          SPICEDB_TOKEN: props.spiceDBToken,
        },
        bundling: {
          externalModules: ['aws-sdk'],
          nodeModules: ['@authzed/authzed-node'],
        },
      }
    );

    // ========================================================================
    // EventBridge Rule for Usage Tracking
    // ========================================================================
    const usageEventRule = new Rule(this, 'UsageEventRule', {
      description: 'Route usage events to usage tracker',
      eventPattern: {
        source: ['genai.usage'],
        detailType: ['UsageEvent'],
      } as EventPattern,
    });

    usageEventRule.addTarget(new LambdaFunction(this.usageTrackerFunction));
  }

  /**
   * Grant permission to send usage events to EventBridge
   */
  grantSendUsageEvents(grantee: any) {
    grantee.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'events:source': 'genai.usage',
          },
        },
      })
    );
  }
}
