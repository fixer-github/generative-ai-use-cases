/**
 * User Billing API Construct
 *
 * ユーザ向けの課金・プラン関連のAPIエンドポイントを定義します。
 * このConstructは、エンドユーザが直接呼び出すAPIを提供し、
 * 管理者向けAPIとは明確に分離されています。
 */

import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS, DEFAULT_TENANT_ID } from '../../../consts';
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
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { TenantManager } from '../../construct/tenant-manager';
import OrchestrationApi from './orchestration';
import PaymentGatewayApi from './payment-gateway';

export interface UserBillingApiProps {
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
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Orchestration Functions from OrchestrationApi
   * (purchaseFlow, cancellationFlow呼び出しのため)
   */
  readonly orchestrationFunctions?: OrchestrationApi['orchestrationFunctions'];

  /**
   * Payment Gateway API instance
   * (createCheckoutSession関数を再利用するため)
   */
  readonly paymentGatewayApi?: PaymentGatewayApi;

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
   * DynamoDB table for pending plan change requests (parental approval)
   */
  readonly pendingPlanChangesTable?: ITable;

  /**
   * DynamoDB table for pending parental checkout requests (parental approval for new purchases)
   */
  readonly pendingParentalCheckoutsTable?: ITable;
}

class UserBillingApi extends Construct {
  // Public プロパティとして関数を公開（必要に応じて）
  public readonly listPlansFunction: NodejsFunction;
  public readonly createCheckoutSessionFunction: NodejsFunction;
  public readonly getCheckoutSessionStatusFunction: NodejsFunction;
  public readonly sendCheckoutLinkToParentFunction: NodejsFunction;
  public readonly sendPlanChangeLinkToParentFunction?: NodejsFunction;
  public readonly getPlanChangeRequestStatusFunction?: NodejsFunction;
  public readonly getParentalCheckoutRequestStatusFunction?: NodejsFunction;
  public readonly getPendingParentalConsentRequestFunction?: NodejsFunction;
  public readonly activateFromSessionFunction?: NodejsFunction;
  public readonly getCurrentSubscriptionFunction?: NodejsFunction;
  public readonly cancelSubscriptionFunction?: NodejsFunction;
  public readonly changeSubscriptionPlanFunction?: NodejsFunction;
  public readonly previewPlanChangeFunction?: NodejsFunction;
  public readonly createCustomerPortalFunction: NodejsFunction;
  public readonly createPaymentMethodUpdateSessionFunction: NodejsFunction;
  public readonly sendPaymentMethodUpdateToParentFunction: NodejsFunction;
  public readonly getStoreInfoFunction: NodejsFunction;
  public readonly getUsageStatusFunction: NodejsFunction;
  public readonly updateUserProfileFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: UserBillingApiProps) {
    super(scope, id);

    const {
      api,
      userPool,
      userPoolClient,
      idPool,
      tenantManager,
      environment,
    } = props;

    // Common Lambda configuration
    const commonEnvironment = {
      ENVIRONMENT: environment,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      IDENTITY_POOL_ID: idPool.identityPoolId,
      TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
      DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
      AWS_ACCOUNT_ID: process.env.CDK_DEFAULT_ACCOUNT || '',
    };

    // Create Cognito authorizer for protected endpoints
    const authorizer = new CognitoUserPoolsAuthorizer(
      this,
      'UserBillingAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: 'UserBillingAuthorizer',
      }
    );

    // ========================================
    // /api エンドポイントの作成
    // ========================================

    const apiResource = api.root.addResource('api');

    // ========================================
    // API 1: プラン一覧取得API
    // GET /api/plans?platform={platform}
    // ========================================

    this.listPlansFunction = new NodejsFunction(this, 'ListPlans', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/user-api/plans/listPlans.ts',
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnvironment,
    });

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(this.listPlansFunction);

    // Lambda呼び出し権限（データアクセス層用）
    this.listPlansFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.listPlansFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.listPlansFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.listPlansFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // API Gatewayエンドポイント
    const plansResource = apiResource.addResource('plans');
    plansResource.addMethod(
      'GET',
      new LambdaIntegration(this.listPlansFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 2: Checkout Session作成API
    // POST /api/subscriptions/checkout-session
    // ========================================

    // ユーザ向けのCheckout Session作成Lambda関数を定義
    this.createCheckoutSessionFunction = new NodejsFunction(
      this,
      'CreateCheckoutSession',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/createCheckoutSession.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          ...commonEnvironment,
        },
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.createCheckoutSessionFunction
    );

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.createCheckoutSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // Lambda呼び出し権限（データアクセス層用）
    this.createCheckoutSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.createCheckoutSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.createCheckoutSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // API Gatewayエンドポイントを作成
    const subscriptionsResource = apiResource.addResource('subscriptions');
    const checkoutSessionResource =
      subscriptionsResource.addResource('checkout-session');
    checkoutSessionResource.addMethod(
      'POST',
      new LambdaIntegration(this.createCheckoutSessionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 3: セッション状態確認API
    // GET /api/subscriptions/checkout-session/{sessionId}/status
    // ========================================

    this.getCheckoutSessionStatusFunction = new NodejsFunction(
      this,
      'GetCheckoutSessionStatus',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/getCheckoutSessionStatus.ts',
        timeout: Duration.seconds(10),
        memorySize: 256,
        environment: commonEnvironment,
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.getCheckoutSessionStatusFunction
    );

    // Secrets Manager読み取り権限
    this.getCheckoutSessionStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    const sessionIdResource =
      checkoutSessionResource.addResource('{sessionId}');
    const statusResource = sessionIdResource.addResource('status');
    statusResource.addMethod(
      'GET',
      new LambdaIntegration(this.getCheckoutSessionStatusFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 3.5: 保護者向け決済リンク送信API（ペアレンタルコントロール）
    // POST /api/subscriptions/send-checkout-to-parent
    // ========================================

    this.sendCheckoutLinkToParentFunction = new NodejsFunction(
      this,
      'SendCheckoutLinkToParent',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/sendCheckoutLinkToParent.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          ...commonEnvironment,
          SERVICE_NAME: props.emailServiceName,
          SENDGRID_API_KEY: props.sendgridApiKey,
          SENDGRID_FROM_EMAIL: props.sendgridFromEmail,
          ...(props.pendingParentalCheckoutsTable && {
            PENDING_PARENTAL_CHECKOUTS_TABLE_NAME:
              props.pendingParentalCheckoutsTable.tableName,
          }),
        },
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.sendCheckoutLinkToParentFunction
    );

    // Grant DynamoDB write access for pending parental checkouts
    if (props.pendingParentalCheckoutsTable) {
      props.pendingParentalCheckoutsTable.grantReadWriteData(
        this.sendCheckoutLinkToParentFunction
      );
    }

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.sendCheckoutLinkToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // Lambda呼び出し権限（データアクセス層用）
    this.sendCheckoutLinkToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.sendCheckoutLinkToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.sendCheckoutLinkToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // API Gatewayエンドポイント
    const sendToParentResource = subscriptionsResource.addResource(
      'send-checkout-to-parent'
    );
    sendToParentResource.addMethod(
      'POST',
      new LambdaIntegration(this.sendCheckoutLinkToParentFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 3.6: 保護者向けプラン変更リンク送信API（ペアレンタルコントロール）
    // POST /api/subscriptions/send-plan-change-to-parent
    // ========================================

    if (
      props.pendingPlanChangesTable &&
      props.orchestrationFunctions?.planChangeFlow
    ) {
      this.sendPlanChangeLinkToParentFunction = new NodejsFunction(
        this,
        'SendPlanChangeLinkToParent',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/sendPlanChangeLinkToParent.ts',
          timeout: Duration.seconds(30),
          memorySize: 256,
          environment: {
            ...commonEnvironment,
            SERVICE_NAME: props.emailServiceName,
            SENDGRID_API_KEY: props.sendgridApiKey,
            SENDGRID_FROM_EMAIL: props.sendgridFromEmail,
            PENDING_PLAN_CHANGES_TABLE_NAME:
              props.pendingPlanChangesTable.tableName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.sendPlanChangeLinkToParentFunction
      );

      // Grant DynamoDB write access for pending plan changes
      props.pendingPlanChangesTable.grantReadWriteData(
        this.sendPlanChangeLinkToParentFunction
      );

      // Secrets Manager読み取り権限（Stripe APIキー取得用）
      this.sendPlanChangeLinkToParentFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
        })
      );

      // Lambda呼び出し権限（データアクセス層用）
      this.sendPlanChangeLinkToParentFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-user-plan-application-data-access`,
          ],
        })
      );

      // IAM Role Assume権限（テナント専用クレデンシャル取得用）
      this.sendPlanChangeLinkToParentFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: ['arn:aws:iam::*:role/TenantRole-*'],
        })
      );

      // Grant STS AssumeRoleWithWebIdentity permission
      this.sendPlanChangeLinkToParentFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: ['*'],
        })
      );

      // API Gatewayエンドポイント
      const sendPlanChangeToParentResource = subscriptionsResource.addResource(
        'send-plan-change-to-parent'
      );
      sendPlanChangeToParentResource.addMethod(
        'POST',
        new LambdaIntegration(this.sendPlanChangeLinkToParentFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );

      // ========================================
      // API 3.7: プラン変更リクエストステータス確認API
      // GET /api/subscriptions/plan-change-request/{requestId}/status
      // ========================================

      this.getPlanChangeRequestStatusFunction = new NodejsFunction(
        this,
        'GetPlanChangeRequestStatus',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/getPlanChangeRequestStatus.ts',
          timeout: Duration.seconds(10),
          memorySize: 256,
          environment: {
            ...commonEnvironment,
            PENDING_PLAN_CHANGES_TABLE_NAME:
              props.pendingPlanChangesTable.tableName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.getPlanChangeRequestStatusFunction
      );

      // Grant DynamoDB read access for pending plan changes
      props.pendingPlanChangesTable.grantReadData(
        this.getPlanChangeRequestStatusFunction
      );

      // API Gatewayエンドポイント
      const planChangeRequestResource = subscriptionsResource.addResource(
        'plan-change-request'
      );
      const planChangeRequestIdResource =
        planChangeRequestResource.addResource('{requestId}');
      const planChangeRequestStatusResource =
        planChangeRequestIdResource.addResource('status');
      planChangeRequestStatusResource.addMethod(
        'GET',
        new LambdaIntegration(this.getPlanChangeRequestStatusFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 3.8: ペアレンタルチェックアウトリクエストステータス確認API
    // GET /api/subscriptions/parental-checkout-request/{requestId}/status
    // ========================================

    if (props.pendingParentalCheckoutsTable) {
      this.getParentalCheckoutRequestStatusFunction = new NodejsFunction(
        this,
        'GetParentalCheckoutRequestStatus',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/getParentalCheckoutRequestStatus.ts',
          timeout: Duration.seconds(10),
          memorySize: 256,
          environment: {
            ...commonEnvironment,
            PENDING_PARENTAL_CHECKOUTS_TABLE_NAME:
              props.pendingParentalCheckoutsTable.tableName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.getParentalCheckoutRequestStatusFunction
      );

      // Grant DynamoDB read access for pending parental checkouts
      props.pendingParentalCheckoutsTable.grantReadData(
        this.getParentalCheckoutRequestStatusFunction
      );

      // API Gatewayエンドポイント
      const parentalCheckoutRequestResource = subscriptionsResource.addResource(
        'parental-checkout-request'
      );
      const parentalCheckoutRequestIdResource =
        parentalCheckoutRequestResource.addResource('{requestId}');
      const parentalCheckoutRequestStatusResource =
        parentalCheckoutRequestIdResource.addResource('status');
      parentalCheckoutRequestStatusResource.addMethod(
        'GET',
        new LambdaIntegration(this.getParentalCheckoutRequestStatusFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 3.9: 保留中の保護者同意リクエスト取得API
    // GET /api/subscriptions/parental-consent-request/pending
    // ========================================

    // 両方のテーブルがある場合に有効化
    if (props.pendingParentalCheckoutsTable || props.pendingPlanChangesTable) {
      this.getPendingParentalConsentRequestFunction = new NodejsFunction(
        this,
        'GetPendingParentalConsentRequest',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/getPendingParentalConsentRequest.ts',
          timeout: Duration.seconds(10),
          memorySize: 256,
          environment: {
            ...commonEnvironment,
            PENDING_PARENTAL_CHECKOUTS_TABLE_NAME:
              props.pendingParentalCheckoutsTable?.tableName || '',
            PENDING_PLAN_CHANGES_TABLE_NAME:
              props.pendingPlanChangesTable?.tableName || '',
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.getPendingParentalConsentRequestFunction
      );

      // Grant DynamoDB read access for both tables
      if (props.pendingParentalCheckoutsTable) {
        props.pendingParentalCheckoutsTable.grantReadData(
          this.getPendingParentalConsentRequestFunction
        );
      }
      if (props.pendingPlanChangesTable) {
        props.pendingPlanChangesTable.grantReadData(
          this.getPendingParentalConsentRequestFunction
        );
      }

      // API Gatewayエンドポイント
      const parentalConsentRequestResource = subscriptionsResource.addResource(
        'parental-consent-request'
      );
      const pendingResource =
        parentalConsentRequestResource.addResource('pending');
      pendingResource.addMethod(
        'GET',
        new LambdaIntegration(this.getPendingParentalConsentRequestFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 4: プランアクティベーションAPI
    // POST /api/subscriptions/activate-from-session
    // ========================================

    // orchestrationFunctionsが渡された場合のみ実装可能
    if (props.orchestrationFunctions) {
      this.activateFromSessionFunction = new NodejsFunction(
        this,
        'ActivateFromSession',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/activateFromSession.ts',
          timeout: Duration.seconds(60), // Orchestrationフロー呼び出しを含むため長めに設定
          memorySize: 512,
          environment: {
            ...commonEnvironment,
            PURCHASE_FLOW_FUNCTION_NAME:
              props.orchestrationFunctions.purchaseFlow.functionName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.activateFromSessionFunction
      );

      // Secrets Manager読み取り権限
      this.activateFromSessionFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
        })
      );

      // Lambda呼び出し権限（Orchestrationフロー用）
      this.activateFromSessionFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [props.orchestrationFunctions.purchaseFlow.functionArn],
        })
      );

      // API Gatewayエンドポイント
      const activateResource = subscriptionsResource.addResource(
        'activate-from-session'
      );
      activateResource.addMethod(
        'POST',
        new LambdaIntegration(this.activateFromSessionFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 5: 現在のプラン情報取得API
    // GET /api/subscriptions/current
    // ========================================

    // USER_REGISTRATION_METADATA テーブル名を構築
    const userRegistrationMetadataTableName = `UserRegistrationMetadata-${environment}`;

    this.getCurrentSubscriptionFunction = new NodejsFunction(
      this,
      'GetCurrentSubscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/getCurrentSubscription.ts',
        timeout: Duration.seconds(10),
        memorySize: 256,
        environment: {
          ...commonEnvironment,
          USER_REGISTRATION_METADATA_TABLE_NAME:
            userRegistrationMetadataTableName,
        },
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.getCurrentSubscriptionFunction
    );

    // Lambda呼び出し権限（データアクセス層用）
    this.getCurrentSubscriptionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
          `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
          `arn:aws:lambda:*:*:function:${environment}-*-user-plan-application-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.getCurrentSubscriptionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.getCurrentSubscriptionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.getCurrentSubscriptionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // DynamoDB読み取り権限（USER_REGISTRATION_METADATAテーブル - 生年月日取得用）
    this.getCurrentSubscriptionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:*:*:table/${userRegistrationMetadataTableName}`,
        ],
      })
    );

    const currentResource = subscriptionsResource.addResource('current');
    currentResource.addMethod(
      'GET',
      new LambdaIntegration(this.getCurrentSubscriptionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 6: サブスクリプション解約API
    // POST /api/subscriptions/cancel
    // ========================================

    if (props.orchestrationFunctions) {
      this.cancelSubscriptionFunction = new NodejsFunction(
        this,
        'CancelSubscription',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/cancelSubscription.ts',
          timeout: Duration.seconds(60), // Orchestrationフロー呼び出しを含むため長めに設定
          memorySize: 512,
          environment: {
            ...commonEnvironment,
            CANCELLATION_FLOW_FUNCTION_NAME:
              props.orchestrationFunctions.cancellationFlow.functionName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(this.cancelSubscriptionFunction);

      // Lambda呼び出し権限（Orchestration cancellationFlow用）
      this.cancelSubscriptionFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            props.orchestrationFunctions.cancellationFlow.functionArn,
          ],
        })
      );

      // API Gatewayエンドポイント
      const cancelResource = subscriptionsResource.addResource('cancel');
      cancelResource.addMethod(
        'POST',
        new LambdaIntegration(this.cancelSubscriptionFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 7: プラン変更API
    // POST /api/subscriptions/change-plan
    // ========================================

    if (props.orchestrationFunctions?.planChangeFlow) {
      this.changeSubscriptionPlanFunction = new NodejsFunction(
        this,
        'ChangeSubscriptionPlan',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry:
            './lambda/billing/user-api/subscriptions/changeSubscriptionPlan.ts',
          timeout: Duration.seconds(60), // Orchestrationフロー呼び出しを含むため長めに設定
          memorySize: 512,
          environment: {
            ...commonEnvironment,
            PLAN_CHANGE_FLOW_FUNCTION_NAME:
              props.orchestrationFunctions.planChangeFlow.functionName,
          },
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(
        this.changeSubscriptionPlanFunction
      );

      // Lambda呼び出し権限（データアクセス層用）
      this.changeSubscriptionPlanFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:*:*:function:${environment}-*-user-plan-application-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
          ],
        })
      );

      // Secrets Manager読み取り権限（Stripe APIキー取得用）
      this.changeSubscriptionPlanFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
        })
      );

      // Lambda呼び出し権限（Orchestration planChangeFlow用）
      this.changeSubscriptionPlanFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [props.orchestrationFunctions.planChangeFlow.functionArn],
        })
      );

      // IAM Role Assume権限（テナント専用クレデンシャル取得用）
      this.changeSubscriptionPlanFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: ['arn:aws:iam::*:role/TenantRole-*'],
        })
      );

      // Grant STS AssumeRoleWithWebIdentity permission
      this.changeSubscriptionPlanFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: ['*'],
        })
      );

      // API Gatewayエンドポイント
      const changePlanResource =
        subscriptionsResource.addResource('change-plan');
      changePlanResource.addMethod(
        'POST',
        new LambdaIntegration(this.changeSubscriptionPlanFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );

      // ========================================
      // API 7b: プラン変更プレビューAPI
      // POST /api/subscriptions/preview-plan-change
      // ========================================
      this.previewPlanChangeFunction = new NodejsFunction(
        this,
        'PreviewPlanChange',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/billing/user-api/subscriptions/previewPlanChange.ts',
          timeout: Duration.seconds(30),
          memorySize: 256,
          environment: commonEnvironment,
        }
      );

      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(this.previewPlanChangeFunction);

      // Lambda呼び出し権限（データアクセス層用）
      this.previewPlanChangeFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:*:*:function:${environment}-*-user-plan-application-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
            `arn:aws:lambda:*:*:function:${environment}-*-plan-data-access`,
          ],
        })
      );

      // Secrets Manager読み取り権限（Stripe APIキー取得用）
      this.previewPlanChangeFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
        })
      );

      // IAM Role Assume権限（テナント専用クレデンシャル取得用）
      this.previewPlanChangeFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: ['arn:aws:iam::*:role/TenantRole-*'],
        })
      );

      // Grant STS AssumeRoleWithWebIdentity permission
      this.previewPlanChangeFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: ['*'],
        })
      );

      // API Gatewayエンドポイント
      const previewPlanChangeResource = subscriptionsResource.addResource('preview-plan-change');
      previewPlanChangeResource.addMethod(
        'POST',
        new LambdaIntegration(this.previewPlanChangeFunction),
        {
          authorizer: authorizer,
          authorizationType: AuthorizationType.COGNITO,
        }
      );
    }

    // ========================================
    // API 8: Customer Portalセッション作成API
    // POST /api/subscriptions/customer-portal
    //
    // @deprecated Use createPaymentMethodUpdateSession for updating payment methods.
    // Customer Portal updates the customer's default payment method,
    // but does NOT immediately update the subscription's payment method.
    // ========================================

    this.createCustomerPortalFunction = new NodejsFunction(
      this,
      'CreateCustomerPortal',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/createCustomerPortal.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: commonEnvironment,
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(this.createCustomerPortalFunction);

    // Lambda invoke権限（Payment Gatewayの関数を呼び出すため）
    this.createCustomerPortalFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-billing-payment-customer-portal`,
        ],
      })
    );

    // API Gatewayエンドポイント
    const customerPortalResource =
      subscriptionsResource.addResource('customer-portal');
    customerPortalResource.addMethod(
      'POST',
      new LambdaIntegration(this.createCustomerPortalFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 9: ストア情報取得API
    // GET /api/store-info
    // ========================================

    this.getStoreInfoFunction = new NodejsFunction(this, 'GetStoreInfo', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/user-api/store-info/getStoreInfo.ts',
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnvironment,
    });

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(this.getStoreInfoFunction);

    // Secrets Manager読み取り権限（Stripe publishable key取得用）
    this.getStoreInfoFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // API Gatewayエンドポイント
    const storeInfoResource = apiResource.addResource('store-info');
    storeInfoResource.addMethod(
      'GET',
      new LambdaIntegration(this.getStoreInfoFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 10: 利用状況確認API
    // POST /api/usage/status
    // ========================================

    this.getUsageStatusFunction = new NodejsFunction(this, 'GetUsageStatus', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/billing/user-api/usage/getUsageStatus.ts',
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: commonEnvironment,
    });

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(this.getUsageStatusFunction);

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.getUsageStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.getUsageStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // Grant OpenFGA API Gateway invoke permissions
    this.getUsageStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: ['arn:aws:execute-api:*:*:*/prod/*'],
      })
    );

    // Grant SSM Parameter Store read permissions for OpenFGA config
    this.getUsageStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiRegion`,
          `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaStoreId`,
        ],
      })
    );

    // API Gatewayエンドポイント
    const usageResource = apiResource.addResource('usage');
    const usageStatusResource = usageResource.addResource('status');
    usageStatusResource.addMethod(
      'POST',
      new LambdaIntegration(this.getUsageStatusFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 11: 支払い方法更新セッション作成API
    // POST /api/subscriptions/update-payment-method
    //
    // サブスクリプションの支払い方法を即座に更新するための
    // Stripe Checkout Session（setup mode）を作成します。
    // ========================================

    this.createPaymentMethodUpdateSessionFunction = new NodejsFunction(
      this,
      'CreatePaymentMethodUpdateSession',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/createPaymentMethodUpdateSession.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: commonEnvironment,
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.createPaymentMethodUpdateSessionFunction
    );

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.createPaymentMethodUpdateSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // Lambda呼び出し権限（データアクセス層用）
    this.createPaymentMethodUpdateSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.createPaymentMethodUpdateSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.createPaymentMethodUpdateSessionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // API Gatewayエンドポイント
    const updatePaymentMethodResource = subscriptionsResource.addResource(
      'update-payment-method'
    );
    updatePaymentMethodResource.addMethod(
      'POST',
      new LambdaIntegration(this.createPaymentMethodUpdateSessionFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 12: 保護者向け支払い方法更新リンク送信API
    // POST /api/subscriptions/send-payment-method-update-to-parent
    //
    // ペアレンタルコントロール用：未成年ユーザーからのリクエストで
    // 保護者のメールアドレスにCustomer Portalリンクを送信します。
    // ========================================

    this.sendPaymentMethodUpdateToParentFunction = new NodejsFunction(
      this,
      'SendPaymentMethodUpdateToParent',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry:
          './lambda/billing/user-api/subscriptions/sendPaymentMethodUpdateToParent.ts',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          ...commonEnvironment,
          SERVICE_NAME: props.emailServiceName,
          SENDGRID_API_KEY: props.sendgridApiKey,
          SENDGRID_FROM_EMAIL: props.sendgridFromEmail,
        },
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(
      this.sendPaymentMethodUpdateToParentFunction
    );

    // Secrets Manager読み取り権限（Stripe APIキー取得用）
    this.sendPaymentMethodUpdateToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
      })
    );

    // Lambda呼び出し権限（データアクセス層用）
    this.sendPaymentMethodUpdateToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:*:*:function:${environment}-*-subscription-data-access`,
          `arn:aws:lambda:*:*:function:${environment}-*-user-plan-application-data-access`,
        ],
      })
    );

    // IAM Role Assume権限（テナント専用クレデンシャル取得用）
    this.sendPaymentMethodUpdateToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: ['arn:aws:iam::*:role/TenantRole-*'],
      })
    );

    // Grant STS AssumeRoleWithWebIdentity permission
    this.sendPaymentMethodUpdateToParentFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRoleWithWebIdentity'],
        resources: ['*'],
      })
    );

    // API Gatewayエンドポイント
    const sendPaymentMethodUpdateToParentResource =
      subscriptionsResource.addResource('send-payment-method-update-to-parent');
    sendPaymentMethodUpdateToParentResource.addMethod(
      'POST',
      new LambdaIntegration(this.sendPaymentMethodUpdateToParentFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API 13: ユーザープロファイル更新API
    // PUT /api/user/profile
    //
    // ユーザーのCognitoカスタム属性を更新します。
    // birthdate, parentEmail の更新が可能です。
    // ========================================

    this.updateUserProfileFunction = new NodejsFunction(
      this,
      'UpdateUserProfile',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/billing/user-api/profile/updateUserProfile.ts',
        timeout: Duration.seconds(10),
        memorySize: 256,
        environment: commonEnvironment,
      }
    );

    // Grant Tenants table read access
    tenantManager.tenantsTable.grantReadData(this.updateUserProfileFunction);

    // Cognito AdminUpdateUserAttributes権限
    this.updateUserProfileFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminUpdateUserAttributes'],
        resources: [userPool.userPoolArn],
      })
    );

    // API Gatewayエンドポイント
    const userResource = apiResource.addResource('user');
    const profileResource = userResource.addResource('profile');
    profileResource.addMethod(
      'PUT',
      new LambdaIntegration(this.updateUserProfileFunction),
      {
        authorizer: authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // ログ出力
    // ========================================

    console.log('User Billing API endpoints created:');
    console.log('  - GET /api/plans');
    console.log('  - POST /api/subscriptions/checkout-session');
    console.log(
      '  - GET /api/subscriptions/checkout-session/{sessionId}/status'
    );
    console.log('  - POST /api/subscriptions/send-checkout-to-parent');
    if (
      props.pendingPlanChangesTable &&
      props.orchestrationFunctions?.planChangeFlow
    ) {
      console.log('  - POST /api/subscriptions/send-plan-change-to-parent');
      console.log(
        '  - GET /api/subscriptions/plan-change-request/{requestId}/status'
      );
    }
    if (props.pendingParentalCheckoutsTable) {
      console.log(
        '  - GET /api/subscriptions/parental-checkout-request/{requestId}/status'
      );
    }
    console.log('  - GET /api/subscriptions/current');
    if (props.orchestrationFunctions) {
      console.log('  - POST /api/subscriptions/activate-from-session');
      console.log('  - POST /api/subscriptions/cancel');
      console.log('  - POST /api/subscriptions/change-plan');
    }
    console.log('  - POST /api/subscriptions/customer-portal (deprecated)');
    console.log('  - POST /api/subscriptions/update-payment-method');
    console.log(
      '  - POST /api/subscriptions/send-payment-method-update-to-parent'
    );
    console.log('  - GET /api/store-info');
    console.log('  - POST /api/usage/status');
    console.log('  - PUT /api/user/profile');
  }
}

export default UserBillingApi;
