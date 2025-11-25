import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  RestApi,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
} from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { TenantManager } from '../../construct/tenant-manager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface SubscriptionManagementApiProps {
  /**
   * API Gateway REST API
   */
  readonly api: RestApi;

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
   * Tenant Manager for multi-tenant RDS access
   */
  readonly tenantManager: TenantManager;

  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC for Lambda functions (optional, required for RDS access)
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Security group for Lambda functions (optional, required for RDS access)
   */
  readonly securityGroup?: ec2.ISecurityGroup;
}

/**
 * Subscription Management API Construct
 *
 * Provides administrator-facing API endpoints for subscription management:
 * 1. Get subscription statistics
 * 2. List subscriptions (with search, filter, sort, pagination)
 * 3. Get subscription details
 * 4. Approve pending verification subscription
 * 5. Reject pending verification subscription
 * 6. Batch approve/reject subscriptions
 * 7. Retry receipt verification
 * 8. Sync with payment platform
 *
 * Also provides internal Lambda functions for orchestrator:
 * 1. createSubscription - Create subscription from purchase flow
 * 2. updateSubscriptionStatus - Update status from webhook handler
 * 3. getSubscription - Get subscription from orchestrator flows
 * 4. extendSubscriptionPeriod - Extend period from payment.succeeded event
 */
class SubscriptionManagementApi extends Construct {
  /**
   * Internal Lambda functions for orchestrator
   * These are not exposed via API Gateway
   */
  public readonly internalFunctions: {
    createSubscription: NodejsFunction;
    updateSubscriptionStatus: NodejsFunction;
    getSubscription: NodejsFunction;
    extendSubscriptionPeriod: NodejsFunction;
  };

  constructor(
    scope: Construct,
    id: string,
    props: SubscriptionManagementApiProps
  ) {
    super(scope, id);

    const {
      api,
      userPool,
      userPoolClient,
      idPool,
      tenantManager,
      environment,
      vpc,
      securityGroup,
    } = props;

    // Create Cognito authorizer
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'SubscriptionManagementAuthorizer',
    });

    // Common Lambda configuration
    const commonLambdaConfig = {
      runtime: LAMBDA_RUNTIME_NODEJS,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
        IDENTITY_POOL_ID: idPool.identityPoolId,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        AWS_ACCOUNT_ID: process.env.CDK_DEFAULT_ACCOUNT || '',
        ENVIRONMENT: environment,
      },
      ...(vpc && securityGroup
        ? {
            vpc,
            securityGroups: [securityGroup],
            vpcSubnets: {
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
          }
        : {}),
    };

    // ========================================
    // Internal Lambda Functions (for Orchestrator)
    // ========================================

    // Internal: Create Subscription
    const createSubscriptionFunction = new NodejsFunction(
      this,
      'InternalCreateSubscription',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/subscription-management/internal/createSubscription.ts',
        functionName: `${environment}-billing-subscription-internal-create`,
      }
    );

    // Internal: Update Subscription Status
    const updateSubscriptionStatusFunction = new NodejsFunction(
      this,
      'InternalUpdateSubscriptionStatus',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts',
        functionName: `${environment}-billing-subscription-internal-update-status`,
      }
    );

    // Internal: Get Subscription
    const getSubscriptionInternalFunction = new NodejsFunction(
      this,
      'InternalGetSubscription',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/subscription-management/internal/getSubscription.ts',
        functionName: `${environment}-billing-subscription-internal-get`,
      }
    );

    // Internal: Extend Subscription Period
    const extendSubscriptionPeriodFunction = new NodejsFunction(
      this,
      'InternalExtendSubscriptionPeriod',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts',
        functionName: `${environment}-billing-subscription-internal-extend-period`,
      }
    );

    // Export internal functions for orchestrator
    this.internalFunctions = {
      createSubscription: createSubscriptionFunction,
      updateSubscriptionStatus: updateSubscriptionStatusFunction,
      getSubscription: getSubscriptionInternalFunction,
      extendSubscriptionPeriod: extendSubscriptionPeriodFunction,
    };

    // ========================================
    // 1. Get Subscription Statistics
    // ========================================
    const getStatisticsFunction = new NodejsFunction(this, 'GetStatistics', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/subscription-management/getStatistics.ts',
      functionName: `${environment}-billing-admin-get-subscription-statistics`,
    });

    // ========================================
    // 2. List Subscriptions
    // ========================================
    const listSubscriptionsFunction = new NodejsFunction(
      this,
      'ListSubscriptions',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/subscription-management/listSubscriptions.ts',
        functionName: `${environment}-billing-admin-list-subscriptions`,
      }
    );

    // ========================================
    // 3. Get Subscription Details
    // ========================================
    const getSubscriptionFunction = new NodejsFunction(
      this,
      'GetSubscription',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/subscription-management/getSubscription.ts',
        functionName: `${environment}-billing-admin-get-subscription`,
      }
    );

    // ========================================
    // 4. Approve Pending Verification Subscription
    // ========================================
    const approveSubscriptionFunction = new NodejsFunction(
      this,
      'ApproveSubscription',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/subscription-management/approveSubscription.ts',
        functionName: `${environment}-billing-admin-approve-subscription`,
      }
    );

    // ========================================
    // 5. Reject Pending Verification Subscription
    // ========================================
    const rejectSubscriptionFunction = new NodejsFunction(
      this,
      'RejectSubscription',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/subscription-management/rejectSubscription.ts',
        functionName: `${environment}-billing-admin-reject-subscription`,
      }
    );

    // ========================================
    // 6. Batch Approve/Reject Subscriptions
    // ========================================
    /* const batchProcessFunction = new NodejsFunction(this, 'BatchProcess', {
      ...commonLambdaConfig,
      timeout: Duration.seconds(60), // Longer timeout for batch operations
      entry: './lambda/billing/admin/subscription-management/batchProcess.ts',
      functionName: `${environment}-billing-admin-batch-process-subscriptions`,
    }); */

    // ========================================
    // 7. Retry Receipt Verification
    // ========================================
    /* const retryVerificationFunction = new NodejsFunction(
      this,
      'RetryVerification',
      {
        ...commonLambdaConfig,
        timeout: Duration.seconds(60), // Longer timeout for verification
        entry:
          './lambda/billing/admin/subscription-management/retryVerification.ts',
        functionName: `${environment}-billing-admin-retry-verification`,
      }
    ); */

    // ========================================
    // 8. Sync with Payment Platform
    // ========================================
    /* const syncPlatformFunction = new NodejsFunction(this, 'SyncPlatform', {
      ...commonLambdaConfig,
      timeout: Duration.seconds(60), // Longer timeout for platform sync
      entry: './lambda/billing/admin/subscription-management/syncPlatform.ts',
      functionName: `${environment}-billing-admin-sync-platform`,
    }); */

    // ========================================
    // IAM Permissions
    // ========================================
    const functions = [
      // Internal functions
      createSubscriptionFunction,
      updateSubscriptionStatusFunction,
      getSubscriptionInternalFunction,
      extendSubscriptionPeriodFunction,
      // Admin API functions
      getStatisticsFunction,
      listSubscriptionsFunction,
      getSubscriptionFunction,
      approveSubscriptionFunction,
      rejectSubscriptionFunction,
      // batchProcessFunction,
      // retryVerificationFunction,
      // syncPlatformFunction,
    ];

    functions.forEach((func) => {
      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(func);

      // Grant Cognito User Pool AdminGetUser permission for real-time role verification
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cognito-idp:AdminGetUser'],
          resources: [userPool.userPoolArn],
        })
      );

      // Grant Cognito Identity Pool access for AssumeRoleWithWebIdentity
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'cognito-identity:GetId',
            'cognito-identity:GetOpenIdToken',
            'cognito-identity:GetCredentialsForIdentity',
          ],
          resources: ['*'],
        })
      );

      // Grant STS AssumeRoleWithWebIdentity permission
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: ['*'],
        })
      );

      // Grant RDS IAM authentication permission
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['rds-db:connect'],
          resources: ['*'], // Tenant-specific resources will be constrained by assumed role
        })
      );
    });

    // Internal functions need Lambda invoke permissions for data access layer
    [
      createSubscriptionFunction,
      updateSubscriptionStatusFunction,
      getSubscriptionInternalFunction,
      extendSubscriptionPeriodFunction,
    ].forEach((func) => {
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
          ],
        })
      );
    });

    // Additional permissions for functions that interact with payment platforms
    /* [retryVerificationFunction, syncPlatformFunction].forEach((func) => {
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:*:*:secret:*\/billing/stripe/*`,
            `arn:aws:secretsmanager:*:*:secret:*\/billing/apple/*`,
            `arn:aws:secretsmanager:*:*:secret:*\/billing/google/*`,
          ],
        })
      );
    }); */

    // ========================================
    // API Gateway Endpoints
    // ========================================
    const adminResource = api.root.resourceForPath('/admin');
    // Get existing 'billing' resource or create if it doesn't exist
    const billingResource =
      adminResource.getResource('billing') ||
      adminResource.addResource('billing');
    const subscriptionsResource = billingResource.addResource('subscriptions');

    // GET /admin/billing/subscriptions/statistics - Get subscription statistics
    const statisticsResource = subscriptionsResource.addResource('statistics');
    statisticsResource.addMethod(
      'GET',
      new LambdaIntegration(getStatisticsFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // GET /admin/billing/subscriptions - List subscriptions
    subscriptionsResource.addMethod(
      'GET',
      new LambdaIntegration(listSubscriptionsFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    /* // POST /admin/billing/subscriptions/batch-process - Batch approve/reject
    const batchProcessResource =
      subscriptionsResource.addResource('batch-process');
    batchProcessResource.addMethod(
      'POST',
      new LambdaIntegration(batchProcessFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    ); */

    // GET /admin/billing/subscriptions/{subscription_id} - Get subscription details
    const subscriptionIdResource =
      subscriptionsResource.addResource('{subscription_id}');
    subscriptionIdResource.addMethod(
      'GET',
      new LambdaIntegration(getSubscriptionFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // POST /admin/billing/subscriptions/{subscription_id}/approve - Approve subscription
    const approveResource = subscriptionIdResource.addResource('approve');
    approveResource.addMethod(
      'POST',
      new LambdaIntegration(approveSubscriptionFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // POST /admin/billing/subscriptions/{subscription_id}/reject - Reject subscription
    const rejectResource = subscriptionIdResource.addResource('reject');
    rejectResource.addMethod(
      'POST',
      new LambdaIntegration(rejectSubscriptionFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // POST /admin/billing/subscriptions/{subscription_id}/retry-verification - Retry verification
    /* const retryResource =
      subscriptionIdResource.addResource('retry-verification');
    retryResource.addMethod(
      'POST',
      new LambdaIntegration(retryVerificationFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    ); */

    // POST /admin/billing/subscriptions/{subscription_id}/sync - Sync with platform
    /* const syncResource = subscriptionIdResource.addResource('sync');
    syncResource.addMethod(
      'POST',
      new LambdaIntegration(syncPlatformFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    ); */
  }
}

export default SubscriptionManagementApi;
