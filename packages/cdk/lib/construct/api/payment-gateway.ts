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
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { TenantManager } from '../../construct/tenant-manager';

export interface PaymentGatewayApiProps {
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
   * Tenant Manager for multi-tenant support
   */
  readonly tenantManager: TenantManager;

  /**
   * EventBridge event bus for webhook event distribution
   */
  readonly eventBus: IEventBus;

  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;
}

class PaymentGatewayApi extends Construct {
  // Public プロパティとして関数を公開（統括責務から直接呼び出すため）
  public readonly verifyReceiptFunction: NodejsFunction;
  public readonly createCheckoutSessionFunction: NodejsFunction;
  public readonly updateSubscriptionFunction: NodejsFunction;
  public readonly cancelSubscriptionFunction: NodejsFunction;
  public readonly createCustomerPortalSessionFunction: NodejsFunction;

  // Internal functions for Lambda-to-Lambda invocation (orchestration flow)
  public readonly cancelSubscriptionInternalFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: PaymentGatewayApiProps) {
    super(scope, id);

    const { api, userPool, userPoolClient, idPool, tenantManager, eventBus, environment } = props;

    // Create Cognito authorizer for protected endpoints
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'PaymentGatewayAuthorizer',
    });

    // ========================================
    // Webhookエンドポイント（3つ）
    // ========================================

    // Stripe Webhookエンドポイント
    const receiveStripeWebhookFunction = new NodejsFunction(
      this,
      'ReceiveStripeWebhook',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/webhook/stripe/receiveWebhook.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          EVENT_BUS_NAME: eventBus.eventBusName,
        },
      }
    );

    // Apple Webhookエンドポイント
    const receiveAppleNotificationFunction = new NodejsFunction(
      this,
      'ReceiveAppleNotification',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          EVENT_BUS_NAME: eventBus.eventBusName,
          APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID || '',
        },
      }
    );

    // Google Webhookエンドポイント
    const receiveGoogleNotificationFunction = new NodejsFunction(
      this,
      'ReceiveGoogleNotification',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/webhook/google/receiveNotification.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          EVENT_BUS_NAME: eventBus.eventBusName,
          GOOGLE_PACKAGE_NAME: process.env.GOOGLE_PACKAGE_NAME || '',
        },
      }
    );

    // ========================================
    // レシート検証処理
    // ========================================

    const verifyReceiptFunction = new NodejsFunction(this, 'VerifyReceipt', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/payment-gateway/verification/verifyReceipt.ts',
      functionName: `${environment}-billing-payment-verify-receipt`,
      timeout: Duration.seconds(120), // フォールバック処理（2秒待機 + 再試行）を考慮して120秒に延長
      memorySize: 512,
      environment: {
        // テナント専用リソースへのアクセスは実行時に動的に決定
      },
    });

    // ========================================
    // 決済操作実行
    // ========================================

    // Checkout Session作成（Stripe）
    const createCheckoutSessionFunction = new NodejsFunction(
      this,
      'CreateCheckoutSession',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/operations/createCheckoutSession.ts',
        functionName: `${environment}-billing-payment-checkout-session`,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
          IDENTITY_POOL_ID: idPool.identityPoolId,
          USER_POOL_ID: userPool.userPoolId,
          USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
          AWS_ACCOUNT_ID: process.env.CDK_DEFAULT_ACCOUNT || '',
          ENVIRONMENT: environment,
        },
      }
    );

    // サブスクリプション変更
    const updateSubscriptionFunction = new NodejsFunction(
      this,
      'UpdateSubscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/operations/updateSubscription.ts',
        functionName: `${environment}-billing-payment-update-subscription`,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          // テナント専用リソースへのアクセスは実行時に動的に決定
        },
      }
    );

    // サブスクリプションキャンセル
    const cancelSubscriptionFunction = new NodejsFunction(
      this,
      'CancelSubscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/operations/cancelSubscription.ts',
        functionName: `${environment}-billing-payment-cancel-subscription`,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          // テナント専用リソースへのアクセスは実行時に動的に決定
        },
      }
    );

    // サブスクリプションキャンセル（内部用 - Lambda-to-Lambda呼び出し専用）
    const cancelSubscriptionInternalFunction = new NodejsFunction(
      this,
      'CancelSubscriptionInternal',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/internal/cancelSubscription.ts',
        functionName: `${environment}-billing-payment-cancel-subscription-internal`,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          // テナント専用リソースへのアクセスは実行時に動的に決定
        },
      }
    );

    // 請求書PDF取得
    const getInvoiceFunction = new NodejsFunction(this, 'GetInvoice', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/payment-gateway/operations/getInvoice.ts',
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        // テナント専用リソースへのアクセスは実行時に動的に決定
      },
    });

    // 請求書メール送信
    const sendInvoiceEmailFunction = new NodejsFunction(
      this,
      'SendInvoiceEmail',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/operations/sendInvoiceEmail.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          SERVICE_NAME: process.env.SERVICE_NAME || 'GenU',
          SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
          SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL || '',
        },
      }
    );

    // Customer Portal Session作成
    const createCustomerPortalSessionFunction = new NodejsFunction(
      this,
      'CreateCustomerPortalSession',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/payment-gateway/operations/createCustomerPortalSession.ts',
        functionName: `${environment}-billing-payment-customer-portal`,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
          IDENTITY_POOL_ID: idPool.identityPoolId,
          USER_POOL_ID: userPool.userPoolId,
          USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
          AWS_ACCOUNT_ID: process.env.CDK_DEFAULT_ACCOUNT || '',
          ENVIRONMENT: environment,
        },
      }
    );

    // ========================================
    // IAMポリシー
    // ========================================

    // Webhookエンドポイントの権限
    [
      receiveStripeWebhookFunction,
      receiveAppleNotificationFunction,
      receiveGoogleNotificationFunction,
    ].forEach((func) => {
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
          resources: [
            'arn:aws:dynamodb:*:*:table/*-payment-gateway-webhook-events',
          ],
        })
      );

      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['events:PutEvents'],
          resources: [eventBus.eventBusArn],
        })
      );
    });

    // Stripe Webhookの追加権限
    receiveStripeWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // レシート検証の権限
    verifyReceiptFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [
          'arn:aws:dynamodb:*:*:table/*-payment-gateway-receipt-cache',
        ],
      })
    );

    verifyReceiptFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/*'],
      })
    );

    // 決済操作の権限
    [
      createCheckoutSessionFunction,
      updateSubscriptionFunction,
      cancelSubscriptionFunction,
      cancelSubscriptionInternalFunction,
      getInvoiceFunction,
      sendInvoiceEmailFunction,
      createCustomerPortalSessionFunction,
    ].forEach((func) => {
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/*'],
        })
      );
    });

    // Checkout Session作成とCustomer Portal作成の追加権限
    [createCheckoutSessionFunction, createCustomerPortalSessionFunction].forEach((func) => {
      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(func);

      // Grant Cognito User Pool AdminGetUser permission
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
    });

    // ========================================
    // API Gateway エンドポイント
    // ========================================

    const billingResource = api.root.addResource('billing');

    // Webhookエンドポイント（認証不要）
    // パターン2: パスパラメータでテナントIDを識別
    // URL形式: POST /billing/webhook/{tenantId}/stripe
    const webhookResource = billingResource.addResource('webhook');
    const tenantResource = webhookResource.addResource('{tenantId}');

    const stripeWebhookResource = tenantResource.addResource('stripe');
    stripeWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveStripeWebhookFunction),
      {
        authorizationType: AuthorizationType.NONE,
      }
    );

    const appleWebhookResource = tenantResource.addResource('apple');
    appleWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveAppleNotificationFunction),
      {
        authorizationType: AuthorizationType.NONE,
      }
    );

    const googleWebhookResource = tenantResource.addResource('google');
    googleWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveGoogleNotificationFunction),
      {
        authorizationType: AuthorizationType.NONE,
      }
    );

    // 決済操作エンドポイント（Cognitoオーソライザー必須）
    // 注: これらは統括責務のLambda関数から直接Lambda呼び出しで使用することを推奨
    // API Gatewayエンドポイントとしても公開する場合は、Cognitoオーソライザーを設定
    const operationsResource = billingResource.addResource('operations');

    // 注: checkoutエンドポイントは /api/subscriptions/checkout-session に移動しました
    // 旧エンドポイント /billing/operations/checkout は削除されました

    const updateResource = operationsResource.addResource('update');
    updateResource.addMethod(
      'POST',
      new LambdaIntegration(updateSubscriptionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    const cancelResource = operationsResource.addResource('cancel');
    cancelResource.addMethod(
      'POST',
      new LambdaIntegration(cancelSubscriptionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    const invoiceResource = operationsResource.addResource('invoice');
    invoiceResource.addMethod(
      'GET',
      new LambdaIntegration(getInvoiceFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    const invoiceSendResource = invoiceResource.addResource('send');
    invoiceSendResource.addMethod(
      'POST',
      new LambdaIntegration(sendInvoiceEmailFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // Customer Portalエンドポイント
    const customerPortalResource = operationsResource.addResource('customer-portal');
    customerPortalResource.addMethod(
      'POST',
      new LambdaIntegration(createCustomerPortalSessionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Lambda関数をプロパティに割り当て（統括責務から直接呼び出すため）
    // ========================================
    this.verifyReceiptFunction = verifyReceiptFunction;
    this.createCheckoutSessionFunction = createCheckoutSessionFunction;
    this.updateSubscriptionFunction = updateSubscriptionFunction;
    this.cancelSubscriptionFunction = cancelSubscriptionFunction;
    this.createCustomerPortalSessionFunction = createCustomerPortalSessionFunction;
    this.cancelSubscriptionInternalFunction = cancelSubscriptionInternalFunction;
  }
}

export default PaymentGatewayApi;
