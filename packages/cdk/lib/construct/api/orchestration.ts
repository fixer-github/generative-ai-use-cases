import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration, Stack } from 'aws-cdk-lib';
import { Effect, PolicyStatement, IRole } from 'aws-cdk-lib/aws-iam';
import { TenantManager } from '../../construct/tenant-manager';
import { Rule, EventPattern, IEventBus } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export interface OrchestrationApiProps {
  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Tenant Manager for multi-tenant DynamoDB access
   */
  readonly tenantManager: TenantManager;

  /**
   * Shared IAM role for background job Lambda functions
   * This role is used by Lambda functions that need to AssumeRole to TenantRole-*
   * for cross-account/cross-tenant access via createTenantDynamoDBClientForBackgroundJob
   */
  readonly backgroundJobRole: IRole;

  /**
   * EventBridge event bus for webhook event distribution
   */
  readonly eventBus: IEventBus;

  /**
   * Plan Management Internal Functions
   */
  readonly planManagementInternalFunctions: {
    applyPlanToUser: NodejsFunction;
    terminatePlanApplication: NodejsFunction;
    updatePlanApplicationStatus: NodejsFunction;
  };

  /**
   * Subscription Management Internal Functions
   */
  readonly subscriptionManagementInternalFunctions: {
    createSubscription: NodejsFunction;
    updateSubscriptionStatus: NodejsFunction;
    getSubscription: NodejsFunction;
    extendSubscriptionPeriod: NodejsFunction;
  };

  /**
   * Payment Gateway Functions (for receipt verification, etc.)
   */
  readonly paymentGatewayFunctions?: {
    verifyReceipt?: NodejsFunction;
    updateSubscription?: NodejsFunction;
    cancelSubscription?: NodejsFunction;
  };
}

/**
 * Orchestration API Construct
 *
 * Provides orchestration Lambda functions for multi-step billing flows:
 * 1. Purchase Flow - Orchestrate purchase process (receipt verification, subscription creation, plan application)
 * 2. Plan Change Flow - Orchestrate plan change process (plan comparison, payment platform update, plan switch)
 * 3. Cancellation Flow - Orchestrate cancellation process (payment platform cancellation, subscription termination)
 * 4. Webhook Event Flow - Orchestrate webhook event processing (payment.succeeded, payment.failed, refund, etc.)
 *
 * These functions coordinate multiple responsibilities (Plan Management, Subscription Management, Payment Gateway)
 * and maintain execution history in DynamoDB for troubleshooting and audit purposes.
 */
class OrchestrationApi extends Construct {
  /**
   * Orchestration Lambda functions for handling multi-step flows
   * These are invoked directly (Lambda invoke) from user-facing API or EventBridge
   */
  public readonly orchestrationFunctions: {
    purchaseFlow: NodejsFunction;
    planChangeFlow: NodejsFunction;
    cancellationFlow: NodejsFunction;
    webhookEventFlow: NodejsFunction;
  };

  constructor(scope: Construct, id: string, props: OrchestrationApiProps) {
    super(scope, id);

    const {
      environment,
      tenantManager,
      backgroundJobRole,
      eventBus,
      planManagementInternalFunctions,
      subscriptionManagementInternalFunctions,
      paymentGatewayFunctions,
    } = props;

    // ========================================
    // Dead Letter Queue for Webhook Event Flow
    // ========================================
    const webhookEventDlq = new Queue(this, 'WebhookEventDlq', {
      queueName: `${environment}-webhook-event-dlq`,
      retentionPeriod: Duration.days(14), // Maximum retention period
      visibilityTimeout: Duration.seconds(30),
    });

    // ========================================
    // Common Lambda Configuration
    // ========================================
    // Note: Idempotency table is now managed per-tenant in TenantOrchestrationDbStack
    // Lambda functions access tenant-specific tables via AssumeRole
    // All Lambda functions use the shared backgroundJobRole for cross-tenant access
    const commonLambdaConfig = {
      runtime: LAMBDA_RUNTIME_NODEJS,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      role: backgroundJobRole,
      environment: {
        TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
        ENVIRONMENT: environment,
        AWS_ACCOUNT_ID: Stack.of(this).account!,
        // Plan Management Internal Functions
        PLAN_MANAGEMENT_APPLY_FUNCTION_NAME:
          planManagementInternalFunctions.applyPlanToUser.functionName,
        PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME:
          planManagementInternalFunctions.terminatePlanApplication.functionName,
        PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME:
          planManagementInternalFunctions.updatePlanApplicationStatus
            .functionName,
        // Subscription Management Internal Functions
        SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME:
          subscriptionManagementInternalFunctions.createSubscription
            .functionName,
        SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME:
          subscriptionManagementInternalFunctions.updateSubscriptionStatus
            .functionName,
        SUBSCRIPTION_MANAGEMENT_GET_FUNCTION_NAME:
          subscriptionManagementInternalFunctions.getSubscription.functionName,
        SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME:
          subscriptionManagementInternalFunctions.extendSubscriptionPeriod
            .functionName,
        // Payment Gateway Functions (optional)
        ...(paymentGatewayFunctions?.verifyReceipt
          ? {
              PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME:
                paymentGatewayFunctions.verifyReceipt.functionName,
            }
          : {}),
        ...(paymentGatewayFunctions?.updateSubscription
          ? {
              PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME:
                paymentGatewayFunctions.updateSubscription.functionName,
            }
          : {}),
        ...(paymentGatewayFunctions?.cancelSubscription
          ? {
              PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME:
                paymentGatewayFunctions.cancelSubscription.functionName,
            }
          : {}),
      },
    };

    // ========================================
    // 1. Purchase Flow Orchestration Lambda
    // ========================================
    const purchaseFlowFunction = new NodejsFunction(this, 'PurchaseFlow', {
      ...commonLambdaConfig,
      entry: './lambda/billing/orchestration/flows/purchaseFlow.ts',
      functionName: `${environment}-billing-orchestration-purchase-flow`,
    });

    // ========================================
    // 2. Plan Change Flow Orchestration Lambda
    // ========================================
    const planChangeFlowFunction = new NodejsFunction(this, 'PlanChangeFlow', {
      ...commonLambdaConfig,
      entry: './lambda/billing/orchestration/flows/planChangeFlow.ts',
      functionName: `${environment}-billing-orchestration-plan-change-flow`,
    });

    // ========================================
    // 3. Cancellation Flow Orchestration Lambda
    // ========================================
    const cancellationFlowFunction = new NodejsFunction(
      this,
      'CancellationFlow',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/orchestration/flows/cancellationFlow.ts',
        functionName: `${environment}-billing-orchestration-cancellation-flow`,
      }
    );

    // ========================================
    // 4. Webhook Event Flow Orchestration Lambda
    // ========================================
    const webhookEventFlowFunction = new NodejsFunction(
      this,
      'WebhookEventFlow',
      {
        ...commonLambdaConfig,
        timeout: Duration.seconds(90), // Longer timeout for webhook event processing
        entry: './lambda/billing/orchestration/flows/webhookEventFlow.ts',
        functionName: `${environment}-billing-orchestration-webhook-event-flow`,
        environment: {
          ...commonLambdaConfig.environment,
          EVENT_BUS_NAME: eventBus.eventBusName,
          // Purchase flow function for parental control activation
          PURCHASE_FLOW_FUNCTION_NAME: purchaseFlowFunction.functionName,
        },
      }
    );

    // ========================================
    // IAM Permissions (added to backgroundJobRole)
    // ========================================
    // Note: Base permissions (Tenants table read, sts:AssumeRole, orchestration DynamoDB)
    // are already added to backgroundJobRole in BillingManagementStack.
    // Here we add additional permissions specific to orchestration functions.
    //
    // IMPORTANT: We use static ARN patterns instead of specific function ARNs to avoid
    // circular dependencies between BackgroundJobRoleDefaultPolicy, BillingManagementStack,
    // and WebStack. The pattern-based approach is sufficient for security as all billing
    // Lambda functions follow the naming convention: ${environment}-billing-*

    // Grant Lambda invoke permission for Plan Management and Subscription Management internal functions
    // Using static ARN patterns to avoid circular dependency with NestedStack resources
    backgroundJobRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          // Plan Management internal functions: ${environment}-billing-plan-internal-*
          `arn:aws:lambda:*:*:function:${environment}-billing-plan-internal-*`,
          // Subscription Management internal functions: ${environment}-billing-subscription-internal-*
          `arn:aws:lambda:*:*:function:${environment}-billing-subscription-internal-*`,
          // Payment Gateway functions: ${environment}-billing-payment-*
          `arn:aws:lambda:*:*:function:${environment}-billing-payment-*`,
          // Orchestration functions (for webhook flow to invoke purchase flow)
          `arn:aws:lambda:*:*:function:${environment}-billing-orchestration-*`,
        ],
      })
    );

    // Permission for Webhook Event Flow to publish events to EventBridge
    // Note: Using static ARN pattern instead of eventBus.eventBusArn to avoid
    // circular dependency between BackgroundJobRoleDefaultPolicy (parent stack),
    // BillingManagementStack (nested), and WebStack (nested).
    backgroundJobRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:*:*:event-bus/${environment}-billing-events`],
      })
    );

    // ========================================
    // EventBridge Rules for Webhook Event Flow
    // ========================================

    // Stripe Webhook Event Rule - matches business event types
    const stripeWebhookRule = new Rule(this, 'StripeWebhookRule', {
      ruleName: `${environment}-stripe-webhook-to-orchestration`,
      eventBus,
      eventPattern: {
        source: ['billing.payment-gateway'],
        detailType: [
          'payment.succeeded',
          'payment.failed',
          'subscription.canceled',
          'payment.refunded',
          'payment_method.updated',
          'subscription.parental_activated',
        ],
        detail: {
          platform: ['stripe'],
        },
      } as EventPattern,
    });

    stripeWebhookRule.addTarget(
      new LambdaFunction(webhookEventFlowFunction, {
        deadLetterQueue: webhookEventDlq,
        maxEventAge: Duration.hours(24),
        retryAttempts: 3,
      })
    );

    // Apple Webhook Event Rule
    const appleWebhookRule = new Rule(this, 'AppleWebhookRule', {
      ruleName: `${environment}-apple-webhook-to-orchestration`,
      eventBus,
      eventPattern: {
        source: ['billing.payment-gateway'],
        detailType: ['Apple Webhook Event'],
        detail: {
          platform: ['apple'],
        },
      } as EventPattern,
    });

    appleWebhookRule.addTarget(
      new LambdaFunction(webhookEventFlowFunction, {
        deadLetterQueue: webhookEventDlq,
        maxEventAge: Duration.hours(24),
        retryAttempts: 3,
      })
    );

    // Google Webhook Event Rule
    const googleWebhookRule = new Rule(this, 'GoogleWebhookRule', {
      ruleName: `${environment}-google-webhook-to-orchestration`,
      eventBus,
      eventPattern: {
        source: ['billing.payment-gateway'],
        detailType: ['Google Webhook Event'],
        detail: {
          platform: ['google'],
        },
      } as EventPattern,
    });

    googleWebhookRule.addTarget(
      new LambdaFunction(webhookEventFlowFunction, {
        deadLetterQueue: webhookEventDlq,
        maxEventAge: Duration.hours(24),
        retryAttempts: 3,
      })
    );

    // ========================================
    // Export Orchestration Functions
    // ========================================
    this.orchestrationFunctions = {
      purchaseFlow: purchaseFlowFunction,
      planChangeFlow: planChangeFlowFunction,
      cancellationFlow: cancellationFlowFunction,
      webhookEventFlow: webhookEventFlowFunction,
    };
  }
}

export default OrchestrationApi;
