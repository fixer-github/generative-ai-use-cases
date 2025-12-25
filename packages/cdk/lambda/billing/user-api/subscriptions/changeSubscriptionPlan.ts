/**
 * User-facing Change Subscription Plan API
 *
 * ユーザ向けのプラン変更API。
 * プラン変更時にStripe Checkout Sessionを作成し、ユーザーに支払い確認画面を表示します。
 * 実際のプラン変更は、Checkoutが完了した後にWebhookハンドラーで処理されます。
 *
 * Frontend API Contract:
 * - Request: { newPlanId: string }
 * - Response: { sessionId, clientSecret } (for embedded checkout)
 *
 * Flow:
 * 1. ユーザーがpreviewPlanChangeでプロレーション金額を確認
 * 2. ユーザーが確認ボタンを押す → このAPIが呼ばれる
 * 3. Stripe Checkout Sessionを作成（プロレーション支払い用）
 * 4. フロントエンドがEmbedded Checkoutを表示
 * 5. 支払い完了後、Webhookでsubscription.plan_changeイベントを処理
 * 6. Webhookハンドラーがサブスクリプションを更新
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

/**
 * リクエストボディの型
 */
interface ChangePlanRequest {
  /** 変更先のプランID */
  newPlanId: string;
}

/**
 * レスポンスボディの型（Checkout Session用）
 */
interface ChangePlanResponse {
  /** Stripe Checkout Session ID */
  sessionId: string;
  /** Embedded Checkout用のclient secret */
  clientSecret: string;
}

/**
 * シークレットのキャッシュ
 */
const stripeApiKeyCache: { [key: string]: string } = {};

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
 * リクエストヘッダーからフロントエンドのベースURLを取得する
 */
function getBaseUrlFromRequest(event: APIGatewayProxyEvent): string {
  const headers = event.headers;

  const origin = headers['origin'] || headers['Origin'];
  if (origin) {
    return origin;
  }

  const referer = headers['referer'] || headers['Referer'];
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Continue if referer parsing fails
    }
  }

  throw new Error('Unable to determine frontend base URL from request headers');
}

/**
 * 最も優先度の高いプラン適用を選択する関数
 */
function getApplicationPriority(
  source: UserPlanApplication['application_source']
): number {
  const priorities = {
    subscription: 5,
    manual: 4,
    campaign: 3,
    trial: 2,
    default: 1,
  };
  return priorities[source] || 0;
}

function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  const sorted = [...applications].sort((a, b) => {
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return sorted[0];
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Change Subscription Plan request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    const requestBody: ChangePlanRequest | null = (() => {
      try {
        return JSON.parse(event.body);
      } catch {
        return null;
      }
    })();

    if (!requestBody) {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { newPlanId } = requestBody;

    if (!newPlanId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: { field: 'newPlanId', reason: 'newPlanIdは必須です' },
      });
    }

    // 3. 現在のプラン適用情報を取得
    const applications = await invokeDataAccessFunction<UserPlanApplication[]>(
      event,
      'user-plan-application',
      'findActiveByUserId',
      { userId }
    );

    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      if (!['active', 'scheduled_termination'].includes(app.application_status)) {
        return false;
      }
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }
      return true;
    });

    const highestPriorityApplication = selectHighestPriorityApplication(activeApplications);

    if (!highestPriorityApplication) {
      return notFound404Response({
        message: '現在有効なプランがありません',
        code: 'NO_ACTIVE_PLAN',
      });
    }

    const currentPlanId = highestPriorityApplication.plan_id;

    // 4. 同じプランへの変更をチェック
    if (currentPlanId === newPlanId) {
      return badRequest400Response({
        message: '同じプランへの変更はできません',
        code: 'SAME_PLAN',
      });
    }

    // 5. サブスクリプションベースのプランか確認
    if (highestPriorityApplication.application_source !== 'subscription') {
      return badRequest400Response({
        message: 'サブスクリプションベースのプランのみ変更可能です',
        code: 'NOT_SUBSCRIPTION_PLAN',
      });
    }

    if (!highestPriorityApplication.application_source_id) {
      return internalServerError500Response({
        message: 'サブスクリプションIDが見つかりません',
        code: 'MISSING_SUBSCRIPTION_ID',
      });
    }

    const subscriptionId = highestPriorityApplication.application_source_id;

    // 6. サブスクリプション情報を取得
    const subscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'findById',
      { subscriptionId }
    );

    if (!subscription) {
      return notFound404Response({
        message: 'アクティブなサブスクリプションが見つかりません',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    }

    // 7. 現在のプランと新しいプランの情報を取得
    const [currentPlan, newPlan] = await Promise.all([
      invokeDataAccessFunction<Plan | null>(event, 'plan', 'findById', { id: currentPlanId }),
      invokeDataAccessFunction<Plan | null>(event, 'plan', 'findById', { id: newPlanId }),
    ]);

    if (!currentPlan) {
      return notFound404Response({
        message: '現在のプランが見つかりません',
        code: 'CURRENT_PLAN_NOT_FOUND',
      });
    }

    if (!newPlan) {
      return badRequest400Response({
        message: '指定されたプランが見つかりません',
        code: 'NEW_PLAN_NOT_FOUND',
      });
    }

    // 8. Stripeプラットフォームのみ対応
    if (subscription.platform_type !== 'stripe') {
      return badRequest400Response({
        message: 'Web版のみプラン変更に対応しています',
        code: 'UNSUPPORTED_PLATFORM',
      });
    }

    const newPriceId = newPlan.platform_product_id;
    if (!newPriceId) {
      return badRequest400Response({
        message: '新しいプランの価格設定が見つかりません',
        code: 'NO_PRICE_ID',
      });
    }

    // 9. Stripe APIを初期化
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 10. 現在のStripeサブスクリプション情報を取得
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.platform_subscription_id
    );

    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    if (!subscriptionItemId) {
      return internalServerError500Response({
        message: 'サブスクリプションアイテムが見つかりません',
        code: 'NO_SUBSCRIPTION_ITEM',
      });
    }

    // 11. アップグレードかダウングレードかを判定（Stripeの価格情報を使用）
    const currentPriceId = stripeSubscription.items.data[0]?.price?.id;
    const [currentPrice, newPriceInfo] = await Promise.all([
      currentPriceId ? stripe.prices.retrieve(currentPriceId) : Promise.resolve(null),
      stripe.prices.retrieve(newPriceId),
    ]);
    const currentAmount = currentPrice?.unit_amount || 0;
    const newAmount = newPriceInfo.unit_amount || 0;
    const isUpgrade = newAmount > currentAmount;

    // 12. 顧客IDを取得
    const customerId = typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

    console.log('Creating checkout session for plan change:', {
      currentPlanId,
      newPlanId,
      isUpgrade,
      subscriptionId,
      platformSubscriptionId: subscription.platform_subscription_id,
    });

    // 13. Return URLを設定（Embedded Checkout用）
    const baseUrl = getBaseUrlFromRequest(event);
    const returnUrl = `${baseUrl}/billing/complete?session_id={CHECKOUT_SESSION_ID}`;

    // 14. Checkout Sessionを作成
    // subscription モードでサブスクリプション更新用のCheckoutを作成
    // これにより、ユーザーは支払い確認画面を経由してプラン変更できる
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      customer: customerId,
      // 既存のサブスクリプションを更新するために line_items で新しいプランを指定
      line_items: [
        {
          price: newPriceId,
          quantity: 1,
        },
      ],
      // サブスクリプション更新設定
      subscription_data: {
        // Note: Checkout modeでは proration_behavior は使用不可
        // 代わりに metadata でフラグを渡し、Webhook側で処理
        metadata: {
          type: 'plan_change',
          previousSubscriptionId: subscription.platform_subscription_id,
          previousPlanId: currentPlanId,
          newPlanId: newPlanId,
          isUpgrade: isUpgrade.toString(),
          internalSubscriptionId: subscriptionId,
          userId,
          tenantId,
        },
      },
      return_url: returnUrl,
      metadata: {
        type: 'plan_change',
        previousSubscriptionId: subscription.platform_subscription_id,
        previousPlanId: currentPlanId,
        planId: newPlanId,
        isUpgrade: isUpgrade.toString(),
        internalSubscriptionId: subscriptionId,
        userId,
        tenantId,
      },
      locale: 'ja',
      allow_promotion_codes: true,
    });

    console.log('Checkout session created for plan change:', {
      sessionId: session.id,
      newPlanId,
      isUpgrade,
    });

    // 14. レスポンスを返す
    const response: ChangePlanResponse = {
      sessionId: session.id,
      clientSecret: session.client_secret || '',
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error creating plan change checkout session:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return badRequest400Response({
        message: error.message,
        code: 'STRIPE_ERROR',
        details: { type: error.type, code: error.code },
      });
    }

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
};
