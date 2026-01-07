/**
 * User-facing Activate Subscription from Session API
 *
 * Stripe Checkout Session完了後にサブスクリプションを有効化するAPI。
 * sessionIdを受け取り、Stripeでセッション検証後、
 * オーケストレーションのpurchaseFlowを呼び出します。
 *
 * 冪等性: purchaseFlow側で担保されるため、このAPI自体では冪等性チェックを行わない
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  ok200Response,
  unauthorized401Response,
  badRequest400Response,
  forbidden403Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import {
  PurchaseFlowInput,
  PurchaseFlowOutput,
} from '../../orchestration/types/flowTypes';

/**
 * リクエストボディの型
 */
interface ActivateFromSessionRequest {
  /** Stripe Checkout Session ID */
  sessionId: string;
}

/**
 * レスポンスボディの型
 */
interface ActivateFromSessionResponse {
  /** 成功フラグ */
  success: boolean;
  /** サブスクリプションID（成功時） */
  subscriptionId?: string;
  /** プランID（成功時） */
  planId?: string;
  /** プラン名（成功時） */
  planName?: string;
  /** 有効化日時（ISO 8601形式） */
  activatedAt?: string;
  /** 次回請求日（ISO 8601形式） */
  nextBillingDate?: string;
  /** メッセージ */
  message?: string;
  /** エラー情報（失敗時） */
  error?: string;
}

// Lambda client instance
const lambdaClient = new LambdaClient({});

/**
 * シークレットのキャッシュ
 */
let stripeApiKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} is empty`);
    }

    const secret = JSON.parse(response.SecretString);
    stripeApiKeyCache[tenantId] = secret.apiKey;

    return secret.apiKey;
  } catch (error) {
    console.error('Failed to retrieve Stripe API key:', error);
    throw new Error('Failed to retrieve payment configuration');
  }
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Activate From Session request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
        details: undefined,
      });
    }

    let requestBody: ActivateFromSessionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
        details: undefined,
      });
    }

    const { sessionId } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!sessionId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'sessionId',
          reason: 'sessionIdは必須です',
        },
      });
    }

    console.log('Validating checkout session:', sessionId);

    // 4. Stripe APIキーを取得し、セッション情報を取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items', 'line_items.data.price.product', 'subscription'],
      });
    } catch (error) {
      console.error('Failed to retrieve checkout session:', error);

      if (error instanceof Stripe.errors.StripeError) {
        if (error.code === 'resource_missing') {
          return notFound404Response({
            message: '指定されたセッションが見つかりません',
            code: 'SESSION_NOT_FOUND',
            details: undefined,
          });
        }
      }

      return internalServerError500Response({
        message: 'Stripeとの通信中にエラーが発生しました',
        code: 'STRIPE_ERROR',
        details: undefined,
      });
    }

    // 5. セッションの状態を確認
    if (session.status !== 'complete') {
      console.error('Session not complete:', {
        sessionId,
        status: session.status,
      });
      return badRequest400Response({
        message: 'チェックアウトセッションがまだ完了していません',
        code: 'SESSION_NOT_COMPLETE',
        details: {
          status: session.status,
        },
      });
    }

    if (session.payment_status !== 'paid') {
      console.error('Payment not completed:', {
        sessionId,
        paymentStatus: session.payment_status,
      });
      return badRequest400Response({
        message: '支払いがまだ完了していません',
        code: 'PAYMENT_INCOMPLETE',
        details: {
          paymentStatus: session.payment_status,
        },
      });
    }

    // 6. 権限チェック: セッションのuserIdとリクエスト送信者が一致するか確認
    const sessionUserId = session.metadata?.userId;
    if (sessionUserId !== userId) {
      console.error('User ID mismatch:', {
        sessionUserId,
        requestUserId: userId,
      });
      return forbidden403Response({
        message: 'このセッションにアクセスする権限がありません',
        code: 'PERMISSION_DENIED',
        details: undefined,
      });
    }

    // 7. プラン変更セッションの場合は専用処理
    // プラン変更はWebhookのsubscription.plan_change_completedで処理されるため、
    // ここでは成功を返すだけ
    if (session.metadata?.type === 'plan_change') {
      console.log('Plan change session detected, returning success', {
        sessionId,
        newPlanId: session.metadata?.newPlanId,
        previousPlanId: session.metadata?.previousPlanId,
      });

      // Stripeサブスクリプション情報を取得してレスポンスを構築
      const stripeSubId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

      // サブスクリプションから次回請求日を取得
      let nextBillingDate: string | undefined;
      if (session.subscription && typeof session.subscription !== 'string') {
        const subscriptionData = session.subscription as unknown as {
          current_period_end?: number;
        };
        if (subscriptionData.current_period_end) {
          nextBillingDate = new Date(
            subscriptionData.current_period_end * 1000
          ).toISOString();
        }
      }

      // プラン名を取得（line_itemsから）
      const lineItem = session.line_items?.data[0];
      const product = lineItem?.price?.product;
      const planName =
        typeof product === 'object' && product !== null
          ? (product as Stripe.Product).name
          : undefined;

      const response: ActivateFromSessionResponse = {
        success: true,
        subscriptionId: stripeSubId,
        planId: session.metadata?.newPlanId,
        planName,
        activatedAt: new Date().toISOString(),
        nextBillingDate,
        message: 'プランが正常に変更されました',
      };

      return ok200Response(response);
    }

    // 8. 新規サブスクリプションの場合：セッションからplanIdを取得
    const planId = session.metadata?.planId;
    if (!planId) {
      console.error('Plan ID not found in session metadata:', {
        sessionId,
        metadata: session.metadata,
      });
      return internalServerError500Response({
        message: 'セッションにプラン情報が含まれていません',
        code: 'PLAN_NOT_FOUND',
        details: undefined,
      });
    }

    // 9. StripeのサブスクリプションIDを取得
    const stripeSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!stripeSubscriptionId) {
      console.error('Subscription ID not found in session:', sessionId);
      return internalServerError500Response({
        message: 'セッションにサブスクリプション情報が含まれていません',
        code: 'SUBSCRIPTION_NOT_FOUND',
        details: undefined,
      });
    }

    console.log('Session validation successful:', {
      sessionId,
      planId,
      stripeSubscriptionId,
    });

    // 10. purchaseFlowを呼び出す
    const purchaseFlowFunctionName = process.env.PURCHASE_FLOW_FUNCTION_NAME;

    if (!purchaseFlowFunctionName) {
      console.error('PURCHASE_FLOW_FUNCTION_NAME is not configured');
      return internalServerError500Response({
        message: 'サーバー設定エラーが発生しました',
        code: 'CONFIGURATION_ERROR',
        details: undefined,
      });
    }

    const flowInput: PurchaseFlowInput = {
      tenantId,
      userId,
      planId,
      paymentPlatform: 'stripe',
      receiptData: {
        sessionId,
        subscriptionId: stripeSubscriptionId,
      },
    };

    console.log('Invoking purchase flow:', {
      functionName: purchaseFlowFunctionName,
      input: { ...flowInput, receiptData: '[REDACTED]' },
    });

    const invokeCommand = new InvokeCommand({
      FunctionName: purchaseFlowFunctionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(flowInput),
    });

    const invokeResult = await lambdaClient.send(invokeCommand);

    // 11. Lambda呼び出し結果の処理
    if (invokeResult.FunctionError) {
      console.error('Purchase flow function error:', {
        functionError: invokeResult.FunctionError,
        payload: invokeResult.Payload
          ? new TextDecoder().decode(invokeResult.Payload)
          : null,
      });

      return internalServerError500Response({
        message: 'プラン有効化処理中にエラーが発生しました',
        code: 'PURCHASE_FLOW_ERROR',
        details: {
          functionError: invokeResult.FunctionError,
        },
      });
    }

    if (!invokeResult.Payload) {
      console.error('Purchase flow returned no payload');
      return internalServerError500Response({
        message: 'プラン有効化処理からのレスポンスが不正です',
        code: 'INVALID_FLOW_RESPONSE',
        details: undefined,
      });
    }

    const flowOutput: PurchaseFlowOutput = JSON.parse(
      new TextDecoder().decode(invokeResult.Payload)
    );

    console.log('Purchase flow completed:', {
      success: flowOutput.success,
      flowExecutionId: flowOutput.flowExecutionId,
      subscriptionId: flowOutput.subscriptionId,
    });

    // 12. フロー実行結果の確認
    if (!flowOutput.success) {
      console.error('Purchase flow failed:', {
        flowExecutionId: flowOutput.flowExecutionId,
        errorDetails: flowOutput.errorDetails,
      });

      return internalServerError500Response({
        message:
          flowOutput.errorDetails?.errorMessage ||
          'プラン有効化処理に失敗しました',
        code: flowOutput.errorDetails?.errorCode || 'ACTIVATION_FAILED',
        details: {
          flowExecutionId: flowOutput.flowExecutionId,
        },
      });
    }

    // 13. 成功レスポンスを返す
    // Stripeサブスクリプションから次回請求日を取得
    let nextBillingDate: string | undefined;
    if (session.subscription && typeof session.subscription !== 'string') {
      // 展開されたSubscriptionオブジェクトから current_period_end を取得
      // Checkout.Sessionの subscription は展開時に特殊な型になるため型アサーションを使用
      const subscriptionData = session.subscription as unknown as {
        current_period_end?: number;
      };
      if (subscriptionData.current_period_end) {
        nextBillingDate = new Date(
          subscriptionData.current_period_end * 1000
        ).toISOString();
      }
    }

    // プラン名を取得（line_itemsから）
    const lineItem = session.line_items?.data[0];
    const product = lineItem?.price?.product;
    const planName =
      typeof product === 'object' && product !== null
        ? (product as Stripe.Product).name
        : undefined;

    const response: ActivateFromSessionResponse = {
      success: true,
      subscriptionId: flowOutput.subscriptionId,
      planId,
      planName,
      activatedAt: new Date().toISOString(),
      nextBillingDate,
      message: 'プランが正常に有効化されました',
    };

    console.log('Activate from session completed successfully:', {
      flowExecutionId: flowOutput.flowExecutionId,
      subscriptionId: flowOutput.subscriptionId,
      planId,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in activateFromSession:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
