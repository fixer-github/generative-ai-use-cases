import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import { GenericApiProps } from './props';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';

export interface PaymentGatewayApiProps extends GenericApiProps {
  readonly webhookEventTable: Table;
  readonly receiptCacheTable: Table;
  readonly stripeWebhookSecret: ISecret;
  readonly eventBusName: string;
  readonly tenantId: string;
}

class PaymentGatewayApi extends Construct {
  constructor(scope: Construct, id: string, props: PaymentGatewayApiProps) {
    super(scope, id);

    const {
      api,
      commonAuthorizerProps,
      webhookEventTable,
      receiptCacheTable,
      stripeWebhookSecret,
      eventBusName,
      tenantId,
    } = props;

    // ========================================
    // Webhookエンドポイント（3つ）
    // ========================================

    // Stripe Webhookエンドポイント
    const receiveStripeWebhookFunction = new NodejsFunction(
      this,
      'ReceiveStripeWebhook',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/webhook/stripe/receiveWebhook.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            'stripe',
            '@aws-sdk/client-eventbridge',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/util-dynamodb',
            '@aws-sdk/client-secrets-manager',
          ],
        },
        environment: {
          STRIPE_WEBHOOK_SECRET_ARN: stripeWebhookSecret.secretArn,
          EVENT_BUS_NAME: eventBusName,
          TENANT_ID: tenantId,
          WEBHOOK_EVENT_TABLE_NAME: webhookEventTable.tableName,
        },
      }
    );

    // Apple Webhookエンドポイント
    const receiveAppleNotificationFunction = new NodejsFunction(
      this,
      'ReceiveAppleNotification',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            '@aws-sdk/client-eventbridge',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/util-dynamodb',
          ],
        },
        environment: {
          EVENT_BUS_NAME: eventBusName,
          TENANT_ID: tenantId,
          WEBHOOK_EVENT_TABLE_NAME: webhookEventTable.tableName,
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
        entry: './lambda/billing/payment-gateway/webhook/google/receiveNotification.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            '@aws-sdk/client-eventbridge',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/util-dynamodb',
          ],
        },
        environment: {
          EVENT_BUS_NAME: eventBusName,
          TENANT_ID: tenantId,
          WEBHOOK_EVENT_TABLE_NAME: webhookEventTable.tableName,
          GOOGLE_PACKAGE_NAME: process.env.GOOGLE_PACKAGE_NAME || '',
        },
      }
    );

    // ========================================
    // レシート検証処理
    // ========================================

    const verifyReceiptFunction = new NodejsFunction(
      this,
      'VerifyReceipt',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/verification/verifyReceipt.ts',
        timeout: Duration.seconds(60),
        memorySize: 512,
        bundling: {
          nodeModules: [
            'stripe',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/util-dynamodb',
            '@aws-sdk/client-secrets-manager',
            'googleapis',
          ],
        },
        environment: {
          RECEIPT_CACHE_TABLE_NAME: receiptCacheTable.tableName,
          TENANT_ID: tenantId,
        },
      }
    );

    // ========================================
    // 決済操作実行
    // ========================================

    // Checkout Session作成（Stripe）
    const createCheckoutSessionFunction = new NodejsFunction(
      this,
      'CreateCheckoutSession',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/operations/createCheckoutSession.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            'stripe',
            '@aws-sdk/client-secrets-manager',
            '@aws-sdk/client-cognito-identity-provider',
          ],
        },
        environment: {
          TENANT_ID: tenantId,
          USER_POOL_ID: process.env.USER_POOL_ID || '',
        },
      }
    );

    // サブスクリプション変更
    const updateSubscriptionFunction = new NodejsFunction(
      this,
      'UpdateSubscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/operations/updateSubscription.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            'stripe',
            '@aws-sdk/client-secrets-manager',
            'googleapis',
          ],
        },
        environment: {
          TENANT_ID: tenantId,
        },
      }
    );

    // サブスクリプションキャンセル
    const cancelSubscriptionFunction = new NodejsFunction(
      this,
      'CancelSubscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/payment-gateway/operations/cancelSubscription.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          nodeModules: [
            'stripe',
            '@aws-sdk/client-secrets-manager',
            'googleapis',
          ],
        },
        environment: {
          TENANT_ID: tenantId,
        },
      }
    );

    // 請求書PDF取得
    const getInvoiceFunction = new NodejsFunction(this, 'GetInvoice', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/payment-gateway/operations/getInvoice.ts',
      timeout: Duration.seconds(30),
      memorySize: 256,
      bundling: {
        nodeModules: ['stripe', '@aws-sdk/client-secrets-manager'],
      },
      environment: {
        TENANT_ID: tenantId,
      },
    });

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
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          resources: [webhookEventTable.tableArn],
        })
      );

      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['events:PutEvents'],
          resources: [
            `arn:aws:events:${this.node.addr}:${this.node.addr}:event-bus/${eventBusName}`,
          ],
        })
      );
    });

    // Stripe Webhookの追加権限
    receiveStripeWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [stripeWebhookSecret.secretArn],
      })
    );

    // レシート検証の権限
    verifyReceiptFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [receiptCacheTable.tableArn],
      })
    );

    verifyReceiptFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:*:*:secret:${tenantId}/billing/*`,
        ],
      })
    );

    // 決済操作の権限
    [
      createCheckoutSessionFunction,
      updateSubscriptionFunction,
      cancelSubscriptionFunction,
      getInvoiceFunction,
    ].forEach((func) => {
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:*:*:secret:${tenantId}/billing/*`,
          ],
        })
      );
    });

    // Checkout Session作成の追加権限（Cognito）
    createCheckoutSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser'],
        resources: [`arn:aws:cognito-idp:*:*:userpool/*`],
      })
    );

    // ========================================
    // API Gateway エンドポイント
    // ========================================

    const billingResource = api.root.addResource('billing');

    // Webhookエンドポイント（認証不要）
    const webhookResource = billingResource.addResource('webhook');

    const stripeWebhookResource = webhookResource.addResource('stripe');
    stripeWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveStripeWebhookFunction)
    );

    const appleWebhookResource = webhookResource.addResource('apple');
    appleWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveAppleNotificationFunction)
    );

    const googleWebhookResource = webhookResource.addResource('google');
    googleWebhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiveGoogleNotificationFunction)
    );

    // 決済操作エンドポイント（Cognitoオーソライザー必須）
    // 注: これらは統括責務のLambda関数から直接Lambda呼び出しで使用することを推奨
    // API Gatewayエンドポイントとしても公開する場合は、Cognitoオーソライザーを設定
    const operationsResource = billingResource.addResource('operations');

    const checkoutResource = operationsResource.addResource('checkout');
    checkoutResource.addMethod(
      'POST',
      new LambdaIntegration(createCheckoutSessionFunction),
      {
        authorizer: commonAuthorizerProps,
      }
    );

    const updateResource = operationsResource.addResource('update');
    updateResource.addMethod(
      'POST',
      new LambdaIntegration(updateSubscriptionFunction),
      {
        authorizer: commonAuthorizerProps,
      }
    );

    const cancelResource = operationsResource.addResource('cancel');
    cancelResource.addMethod(
      'POST',
      new LambdaIntegration(cancelSubscriptionFunction),
      {
        authorizer: commonAuthorizerProps,
      }
    );

    const invoiceResource = operationsResource.addResource('invoice');
    invoiceResource.addMethod(
      'GET',
      new LambdaIntegration(getInvoiceFunction),
      {
        authorizer: commonAuthorizerProps,
      }
    );
  }
}

export default PaymentGatewayApi;
