import { NestedStack, NestedStackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  RestApi,
  Cors,
  ResponseType,
  RequestAuthorizer,
  AuthorizationType,
  IdentitySource,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { TenantManager } from '../../construct/tenant-manager';
import PlanManagementApi from '../../construct/api/plan-management';
import SubscriptionManagementApi from '../../construct/api/subscription-management';
import PaymentGatewayApi from '../../construct/api/payment-gateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import * as path from 'path';

export interface BillingManagementStackProps extends NestedStackProps {
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

    // Create Lambda Request Authorizer function (same as main API)
    const authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
      entry: path.join(__dirname, '../../../lambda/authorizer.ts'),
      handler: 'handler',
      runtime: LAMBDA_RUNTIME_NODEJS,
      timeout: Duration.seconds(10),
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        TENANTS_TABLE_NAME: props.tenantManager.tenantsTable.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });

    // Grant read access to Tenants table
    props.tenantManager.tenantsTable.grantReadData(authorizerFunction);

    // API Gateway Lambda Request Authorizer
    const authorizer = new RequestAuthorizer(this, 'Authorizer', {
      handler: authorizerFunction,
      identitySources: [IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.seconds(0), // Temporarily disabled cache to test
      authorizerName: 'BillingTenantIpAuthorizer',
    });

    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer,
    };

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
      defaultMethodOptions: commonAuthorizerProps,
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

    this.billingApi = billingApi;

    // Note: Orchestration API (統括処理) will be added later as needed
    // It coordinates multiple responsibilities to implement end-to-end business flows
  }
}
