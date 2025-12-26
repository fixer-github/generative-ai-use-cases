/**
 * User-facing Plan Change Preview API
 *
 * プラン変更プレビューAPI。
 * ユーザーが確認ボタンを押す前に、実際に請求される金額を表示するためのAPI。
 * Stripeの`invoices.retrieveUpcoming`を使用して日割り計算金額を取得します。
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
interface PreviewPlanChangeRequest {
  /** 変更先のプランID */
  newPlanId: string;
}

/**
 * レスポンスボディの型
 */
interface PreviewPlanChangeResponse {
  /** 現在のプラン情報 */
  currentPlan: {
    planId: string;
    displayName: string;
    amount: number;
    currency: string;
    interval: string;
  };
  /** 新しいプラン情報 */
  newPlan: {
    planId: string;
    displayName: string;
    amount: number;
    currency: string;
    interval: string;
  };
  /** プロレーション（日割り計算）情報 */
  proration: {
    /** 請求金額（正の値）またはクレジット（負の値） */
    amount: number;
    /** 通貨 */
    currency: string;
    /** 残り日数 */
    daysRemaining: number;
    /** 現在の請求期間終了日（ISO 8601形式） */
    periodEnd: string;
  };
  /** アップグレードかどうか */
  isUpgrade: boolean;
  /** サブスクリプションID（プラン変更時に使用） */
  subscriptionId: string;
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
  console.log('User API: Preview Plan Change request received');

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

    const requestBody: PreviewPlanChangeRequest = (() => {
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

    // 有効なプラン適用をフィルタリング
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

    // 8. Stripeでプロレーション金額を計算
    if (subscription.platform_type !== 'stripe') {
      return badRequest400Response({
        message: 'Web版のみプラン変更プレビューに対応しています',
        code: 'UNSUPPORTED_PLATFORM',
      });
    }

    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // Stripeサブスクリプション情報を取得
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

    // 新しいプランのStripe Price IDを取得
    const newPriceId = newPlan.platform_product_id;
    if (!newPriceId) {
      return badRequest400Response({
        message: '新しいプランの価格設定が見つかりません',
        code: 'NO_PRICE_ID',
      });
    }

    // 現在と新しいプランのStripe価格情報を取得
    const currentPriceId = stripeSubscription.items.data[0]?.price?.id;
    if (!currentPriceId) {
      return internalServerError500Response({
        message: '現在のプランの価格IDが見つかりません',
        code: 'NO_CURRENT_PRICE_ID',
      });
    }

    const [currentPrice, newPrice] = await Promise.all([
      stripe.prices.retrieve(currentPriceId),
      stripe.prices.retrieve(newPriceId),
    ]);

    // 顧客IDを取得
    const customerId = typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

    // Stripeで次回インボイスをプレビュー
    const upcomingInvoice = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.platform_subscription_id,
      subscription_details: {
        items: [
          {
            id: subscriptionItemId,
            price: newPriceId,
          },
        ],
        proration_behavior: 'create_prorations',
      },
    });

    // プロレーション金額を計算（amount < 0のクレジットまたはamount > 0の追加料金）
    // 新規サブスクリプション以外の行（通常はプロレーション）を合計
    const prorationAmount = upcomingInvoice.lines.data
      .filter((line: Stripe.InvoiceLineItem) => {
        // サブスクリプションの新規行でない場合はプロレーション
        return line.description?.toLowerCase().includes('proration') ||
          line.description?.toLowerCase().includes('unused') ||
          line.description?.toLowerCase().includes('remaining');
      })
      .reduce((sum: number, line: Stripe.InvoiceLineItem) => sum + line.amount, 0);

    // 残り日数を計算（subscription objectから期間終了日を取得）
    const subscriptionData = stripeSubscription as unknown as {
      current_period_end: number;
      items: { data: Array<{ current_period_end?: number }> };
    };
    const currentPeriodEnd = subscriptionData.items.data[0]?.current_period_end
      ?? subscriptionData.current_period_end;
    const periodEnd = new Date(currentPeriodEnd * 1000);
    const daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // アップグレードかダウングレードかを判定
    const currentAmount = currentPrice.unit_amount || 0;
    const newAmount = newPrice.unit_amount || 0;
    const isUpgrade = newAmount > currentAmount;

    // インターバル文字列を取得
    const getIntervalString = (price: Stripe.Price): string => {
      if (!price.recurring) return 'one_time';
      const interval = price.recurring.interval;
      const count = price.recurring.interval_count;
      return count === 1 ? interval : `${count}_${interval}s`;
    };

    console.log('Plan change preview calculated:', {
      currentPlanId,
      newPlanId,
      prorationAmount,
      isUpgrade,
      daysRemaining,
    });

    // 9. レスポンスを返す
    const response: PreviewPlanChangeResponse = {
      currentPlan: {
        planId: currentPlan.plan_id,
        displayName: currentPlan.display_name,
        amount: currentAmount,
        currency: currentPrice.currency || 'jpy',
        interval: getIntervalString(currentPrice),
      },
      newPlan: {
        planId: newPlan.plan_id,
        displayName: newPlan.display_name,
        amount: newAmount,
        currency: newPrice.currency || 'jpy',
        interval: getIntervalString(newPrice),
      },
      proration: {
        amount: prorationAmount,
        currency: upcomingInvoice.currency || 'jpy',
        daysRemaining,
        periodEnd: periodEnd.toISOString(),
      },
      isUpgrade,
      subscriptionId,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error previewing plan change:', error);

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
