import { NestedStack, NestedStackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  RestApi,
  Cors,
  ResponseType,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { TenantManager } from '../../construct/tenant-manager';
import PlanManagementApi from '../../construct/api/plan-management';
import SubscriptionManagementApi from '../../construct/api/subscription-management';
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
   * EventBridge event bus name for webhook event distribution
   * @default 'default'
   */
  readonly eventBusName?: string;

  /**
   * Allowed IPv4 address ranges for IP-based access control
   */
  readonly allowedIpV4AddressRanges?: string[] | null;

  /**
   * Allowed IPv6 address ranges for IP-based access control
   */
  readonly allowedIpV6AddressRanges?: string[] | null;
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

  constructor(scope: Construct, id: string, props: BillingManagementStackProps) {
    super(scope, id, props);

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

    // Payment Gateway API
    const paymentGatewayApi = new PaymentGatewayApi(
      this,
      'PaymentGateway',
      {
        api: billingApi,
        userPool: props.userPool,
        eventBusName: props.eventBusName,
      }
    );

    // Orchestration API
    const orchestrationApi = new OrchestrationApi(this, 'Orchestration', {
      environment: props.environment,
      tenantManager: props.tenantManager,
      eventBusName: props.eventBusName || 'default',
      planManagementInternalFunctions: planManagementApi.internalFunctions,
      subscriptionManagementInternalFunctions: subscriptionManagementApi.internalFunctions,
      // paymentGatewayFunctions は必要に応じて追加
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
      value: orchestrationApi.orchestrationFunctions.cancellationFlow.functionArn,
      description: 'Cancellation Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationCancellationFlowFunctionArn`,
    });

    new CfnOutput(this, 'OrchestrationWebhookEventFlowFunctionArn', {
      value: orchestrationApi.orchestrationFunctions.webhookEventFlow.functionArn,
      description: 'Webhook Event Flow Orchestration Lambda Function ARN',
      exportName: `${this.stackName}-OrchestrationWebhookEventFlowFunctionArn`,
    });

    this.billingApi = billingApi;
  }
}
