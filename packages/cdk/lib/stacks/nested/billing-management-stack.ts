import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { TenantManager } from '../../construct/tenant-manager';
import PlanManagementApi from '../../construct/api/plan-management';
import SubscriptionManagementApi from '../../construct/api/subscription-management';
import PaymentGatewayApi from '../../construct/api/payment-gateway';

export interface BillingManagementStackProps extends NestedStackProps {
  /**
   * API Gateway REST API
   */
  readonly api: RestApi;

  /**
   * User Pool for authentication
   */
  readonly userPool: UserPool;

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
}

/**
 * Nested Stack for Billing Management
 *
 * This stack contains all the resources needed for plan and subscription management:
 * - Plan Management API (7 Lambda functions)
 * - Subscription Management API (8 Lambda functions)
 * - Payment Gateway API (8 Lambda functions)
 *
 * Total: 23 Lambda functions
 *
 * Note: Orchestration API (3 Lambda functions) will be added later as needed
 */
export class BillingManagementStack extends NestedStack {
  constructor(scope: Construct, id: string, props: BillingManagementStackProps) {
    super(scope, id, props);

    // Plan Management API
    const planManagementApi = new PlanManagementApi(this, 'PlanManagement', {
      api: props.api,
      userPool: props.userPool,
      idPool: props.idPool,
      tenantManager: props.tenantManager,
      environment: props.environment,
    });

    // Subscription Management API
    const subscriptionManagementApi = new SubscriptionManagementApi(
      this,
      'SubscriptionManagement',
      {
        api: props.api,
        userPool: props.userPool,
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
        api: props.api,
        userPool: props.userPool,
        eventBusName: props.eventBusName,
      }
    );

    // Note: Orchestration API (統括処理) will be added later as needed
    // It coordinates multiple responsibilities to implement end-to-end business flows
  }
}
