import {
  NestedStack,
  NestedStackProps,
  CfnOutput,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RestApi, Cors, ResponseType } from 'aws-cdk-lib/aws-apigateway';
import { IRole, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { EventBus } from 'aws-cdk-lib/aws-events';
import {
  Table,
  AttributeType,
  BillingMode,
  ITable,
} from 'aws-cdk-lib/aws-dynamodb';
import { TenantManager } from '../../construct/tenant-manager';
import PlanManagementApi from '../../construct/api/plan-management';
import SubscriptionManagementApi from '../../construct/api/subscription-management';
import FlowExecutionManagementApi from '../../construct/api/flow-execution-management';
import PaymentGatewayApi from '../../construct/api/payment-gateway';
import OrchestrationApi from '../../construct/api/orchestration';
import UserBillingApi from '../../construct/api/user-billing-api';

export interface BillingManagementStackProps extends NestedStackProps {
  /**
   * User Pool for authentication
   */
  readonly userPool: UserPool;

  /**
   * User Pool Client for authentication
   */
  readonly userPoolClient: UserPoolClient;

  /**
   * Identity Pool for authorization
   */
  readonly idPool: IdentityPool;

  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Tenant Manager for multi-tenant support (required for IAM-based RDS access)
   */
  readonly tenantManager: TenantManager;

  /**
   * Allowed IPv4 address ranges for IP-based access control
   */
  readonly allowedIpV4AddressRanges?: string[] | null;

  /**
   * Allowed IPv6 address ranges for IP-based access control
   */
  readonly allowedIpV6AddressRanges?: string[] | null;

  /**
   * Shared IAM role for background job Lambda functions
   * This role is created in the parent stack and passed here for additional permissions
   */
  readonly backgroundJobRole: IRole;

  /**
   * SendGrid API key for sending emails
   */
  readonly sendgridApiKey: string;

  /**
   * SendGrid sender email address
   */
  readonly sendgridFromEmail: string;

  /**
   * Email service name (displayed in emails)
   */
  readonly emailServiceName: string;

  /**
   * DynamoDB table for user registration metadata (birthdate, parental consent, etc.)
   */
  readonly userRegistrationMetadataTable?: ITable;
}

/**
 * Nested Stack for Billing Management
 *
 * This stack contains all the resources needed for plan and subscription management:
 * - Independent REST API Gateway (separate from main API to avoid CloudFormation 500 resource limit)
 * - Plan Management API (7 Lambda functions)
 * - Subscription Management API (8 Lambda functions)
 * - Payment Gateway API (8 Lambda functions)
 *
 * Total: 23 Lambda functions + dedicated API Gateway
 *
 * Note: Orchestration API (3 Lambda functions) will be added later as needed
 */
export class BillingManagementStack extends NestedStack {
  public readonly billingApi: RestApi;

  constructor(
    scope: Construct,
    id: string,
    props: BillingManagementStackProps
  ) {
    super(scope, id, props);

    const { backgroundJobRole } = props;

    // ========================================
    // Add Additional Permissions to Background Job Role
    // ========================================
    // Base permissions (sts:AssumeRole, Tenants table read) are added in parent stack
    // Here we add permissions specific to billing/orchestration

    // DynamoDB access for orchestration tables (multi-tenant)
    // These tables are managed per-tenant in TenantOrchestrationDbStack
    backgroundJobRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
        ],
        resources: [
          // Idempotency tables
          'arn:aws:dynamodb:*:*:table/*-orchestration-idempotency',
          // Flow execution history tables
          'arn:aws:dynamodb:*:*:table/*-flow-execution-history',
          'arn:aws:dynamodb:*:*:table/*-flow-execution-history/index/*',
          // Flow step execution history tables
          'arn:aws:dynamodb:*:*:table/*-flow-step-execution-history',
        ],
      })
    );

    // ========================================
    // Create Billing EventBus
    // ========================================
    // 環境ごとに専用のEventBusを定義し、イベントの分離と権限の明確化を実現
    const billingEventBus = new EventBus(this, 'BillingEventBus', {
      eventBusName: `${props.environment}-billing-events`,
    });

    // ========================================
    // Create Pending Plan Changes Table
    // ========================================
    // 保護者承認待ちのプラン変更リクエストを保存するテーブル
    const pendingPlanChangesTable = new Table(this, 'PendingPlanChangesTable', {
      tableName: `${props.environment}-pending-plan-changes`,
      partitionKey: {
        name: 'requestId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for token lookup (保護者がリンクをクリックした際のトークン検索用)
    pendingPlanChangesTable.addGlobalSecondaryIndex({
      indexName: 'approvalToken-index',
      partitionKey: {
        name: 'approvalToken',
        type: AttributeType.STRING,
      },
    });

    // GSI for userId lookup (ユーザーの保留中リクエスト検索用)
    // NOTE: 既存テーブルへのGSI追加はCloudFormationでサポートされていますが、
    // データ量によっては追加に時間がかかる場合があります。
    // 本番環境へのデプロイ前に、既存データへの影響を確認してください。
    pendingPlanChangesTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: {
        name: 'userId',
        type: AttributeType.STRING,
      },
    });

    // ========================================
    // Create Pending Parental Checkouts Table
    // ========================================
    // 保護者承認待ちの新規購入リクエストを保存するテーブル
    const pendingParentalCheckoutsTable = new Table(
      this,
      'PendingParentalCheckoutsTable',
      {
        tableName: `${props.environment}-pending-parental-checkouts`,
        partitionKey: {
          name: 'requestId',
          type: AttributeType.STRING,
        },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'ttl',
      }
    );

    // GSI for userId lookup (ユーザーの保留中リクエスト検索用)
    pendingParentalCheckoutsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: {
        name: 'userId',
        type: AttributeType.STRING,
      },
    });

    // ========================================
    // Create Independent REST API for Billing
    // ========================================

    // Create independent REST API with same configuration as main API
    const billingApi = new RestApi(this, 'BillingApi', {
      restApiName: `${props.environment}-billing-api`,
      description: 'Independent API Gateway for Billing Management',
      deployOptions: {
        stageName: 'api',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      cloudWatchRole: true,
    });

    // Add 4XX/5XX CORS headers (same as main API)
    billingApi.addGatewayResponse('BillingApi4XX', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    billingApi.addGatewayResponse('BillingApi5XX', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    // ========================================
    // Create Billing API Endpoints
    // ========================================

    // Plan Management API
    const planManagementApi = new PlanManagementApi(this, 'PlanManagement', {
      api: billingApi,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      idPool: props.idPool,
      tenantManager: props.tenantManager,
      environment: props.environment,
    });

    // Subscription Management API
    const subscriptionManagementApi = new SubscriptionManagementApi(
      this,
      'SubscriptionManagement',
      {
        api: billingApi,
        userPool: props.userPool,
        userPoolClient: props.userPoolClient,
        idPool: props.idPool,
        tenantManager: props.tenantManager,
        environment: props.environment,
      }
    );

    // Flow Execution Management API
    new FlowExecutionManagementApi(this, 'FlowExecutionManagement', {
      api: billingApi,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      idPool: props.idPool,
      tenantManager: props.tenantManager,
      environment: props.environment,
    });

    // Payment Gateway API
    const paymentGatewayApi = new PaymentGatewayApi(this, 'PaymentGateway', {
      api: billingApi,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      idPool: props.idPool,
      tenantManager: props.tenantManager,
      eventBus: billingEventBus,
      environment: props.environment,
    });

    // Orchestration API
    const orchestrationApi = new OrchestrationApi(this, 'Orchestration', {
      environment: props.environment,
      tenantManager: props.tenantManager,
      backgroundJobRole: backgroundJobRole,
      eventBus: billingEventBus,
      planManagementInternalFunctions: planManagementApi.internalFunctions,
      subscriptionManagementInternalFunctions:
        subscriptionManagementApi.internalFunctions,
      paymentGatewayFunctions: {
        verifyReceipt: paymentGatewayApi.verifyReceiptFunction,
        updateSubscription: paymentGatewayApi.updateSubscriptionFunction,
        cancelSubscription:
          paymentGatewayApi.cancelSubscriptionInternalFunction,
      },
      // SendGrid configuration for receipt emails
      sendgridApiKey: props.sendgridApiKey,
      sendgridFromEmail: props.sendgridFromEmail,
      serviceName: props.emailServiceName,
      // Pending Plan Changes Table for parental control status update
      pendingPlanChangesTable: pendingPlanChangesTable,
      // Pending Parental Checkouts Table for parental control new purchase status update
      pendingParentalCheckoutsTable: pendingParentalCheckoutsTable,
    });

    // User Billing API (ユーザ向けエンドポイント)
    const userBillingApi = new UserBillingApi(this, 'UserBillingApi', {
      api: billingApi,
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      idPool: props.idPool,
      tenantManager: props.tenantManager,
      environment: props.environment,
      orchestrationFunctions: orchestrationApi.orchestrationFunctions,
      paymentGatewayApi: paymentGatewayApi,
      sendgridApiKey: props.sendgridApiKey,
      sendgridFromEmail: props.sendgridFromEmail,
      emailServiceName: props.emailServiceName,
      pendingPlanChangesTable: pendingPlanChangesTable,
      pendingParentalCheckoutsTable: pendingParentalCheckoutsTable,
      userRegistrationMetadataTable: props.userRegistrationMetadataTable,
    });

    // ========================================
    // Outputs
    // ========================================

    new CfnOutput(this, 'BillingApiEndpoint', {
      value: billingApi.url,
      description: 'Billing API endpoint URL',
      exportName: `${this.stackName}-BillingApiEndpoint`,
    });

    new CfnOutput(this, 'BillingApiId', {
      value: billingApi.restApiId,
      description: 'Billing API Gateway ID',
      exportName: `${this.stackName}-BillingApiId`,
    });

    // Orchestration Lambda Function ARNs
    new CfnOutput(this, 'OrchestrationPurchaseFlowFunctionArn', {
      value: orchestrationApi.orchestrationFunctions.purchaseFlow.functionArn,
      description: 'Purchase Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationPurchaseFlowFunctionArn`,
    });

    new CfnOutput(this, 'OrchestrationPlanChangeFlowFunctionArn', {
      value: orchestrationApi.orchestrationFunctions.planChangeFlow.functionArn,
      description: 'Plan Change Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationPlanChangeFlowFunctionArn`,
    });

    new CfnOutput(this, 'OrchestrationCancellationFlowFunctionArn', {
      value:
        orchestrationApi.orchestrationFunctions.cancellationFlow.functionArn,
      description: 'Cancellation Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationCancellationFlowFunctionArn`,
    });

    new CfnOutput(this, 'OrchestrationWebhookEventFlowFunctionArn', {
      value:
        orchestrationApi.orchestrationFunctions.webhookEventFlow.functionArn,
      description: 'Webhook Event Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationWebhookEventFlowFunctionArn`,
    });

    this.billingApi = billingApi;
  }
}
