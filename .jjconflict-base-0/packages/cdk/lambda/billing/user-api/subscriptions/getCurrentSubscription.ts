/**
 * 現在のプラン情報取得API
 *
 * ログイン中のユーザが現在どのプランに入っているか、
 * サブスクリプションの状態はどうか、次回請求日はいつか、などの情報を取得します。
 *
 * 重要：対象のユーザに適用されているプランが存在していない場合、
 * デフォルトプランにフォールバックすることは絶対に行わず、エラーを返します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  ok200Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import {
  getTenantId,
  getUsername,
  getBirthdateFromClaims,
} from '../../../utils/tenantUtils';

/**
 * 支払い方法（カード）の型
 */
interface PaymentMethodCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  displayName: string;
}

/**
 * 支払い方法の型
 */
interface PaymentMethod {
  type: string;
  card?: PaymentMethodCard;
}

/**
 * 価格情報の型
 */
interface PriceInfo {
  amount: number;
  currency: string;
  interval: string;
}

/**
 * サブスクリプション詳細情報（支払い方法と価格情報を含む）
 */
interface SubscriptionDetailInfo {
  paymentMethod: PaymentMethod | null;
  priceInfo: PriceInfo | null;
}

/**
 * 現在のプラン情報のレスポンス型
 */
interface CurrentPlanResponse {
  planId: string;
  planName: string;
  displayName: string;
  status: string;
  subscriptionId: string | null;
  platformType: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  serviceEndDate?: string | null;
  subscribedAt: string | null;
  paymentMethod: PaymentMethod | null;
  amount: number;
  currency: string;
  interval: string;
  birthdate: string | null;
}

/**
 * Stripe APIキーのキャッシュ
 */
let stripeApiKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string | null> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      console.log(`Secret ${secretName} is empty`);
      return null;
    }

    const secret = JSON.parse(response.SecretString);
    if (!secret.apiKey) {
      console.log(`API key not configured for tenant ${tenantId}`);
      return null;
    }

    stripeApiKeyCache[tenantId] = secret.apiKey;
    return secret.apiKey;
  } catch (error) {
    console.error('Failed to retrieve Stripe API key:', error);
    return null;
  }
}

/**
 * Stripe PaymentMethodオブジェクトからカード情報を抽出する
 */
function extractCardFromPaymentMethod(
  paymentMethod: Stripe.PaymentMethod
): PaymentMethod | null {
  if (paymentMethod.type !== 'card' || !paymentMethod.card) {
    console.log('Payment method is not a card', {
      paymentMethodType: paymentMethod.type,
    });
    return null;
  }

  const card = paymentMethod.card;
  const brandDisplay = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);

  return {
    type: 'card',
    card: {
      brand: card.brand,
      last4: card.last4 || '',
      expMonth: card.exp_month,
      expYear: card.exp_year,
      displayName: `${brandDisplay} •••• ${card.last4}`,
    },
  };
}

/**
 * 文字列からIDを抽出する（オブジェクトの場合はidプロパティを取得）
 */
function extractId(
  value: string | { id: string } | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if ('id' in value) {
    return value.id;
  }
  return null;
}

/**
 * 顧客IDを取得する
 */
function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!customer) {
    return null;
  }
  if (typeof customer === 'string') {
    return customer;
  }
  if ('id' in customer) {
    return customer.id;
  }
  return null;
}

/**
 * 顧客IDと支払い方法IDを使用してPaymentMethodを取得する
 * GET /v1/customers/{customer_id}/payment_methods/{payment_method_id}
 */
async function retrieveCustomerPaymentMethod(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string
): Promise<Stripe.PaymentMethod | null> {
  try {
    console.log('Retrieving payment method:', { customerId, paymentMethodId });
    return await stripe.customers.retrievePaymentMethod(
      customerId,
      paymentMethodId
    );
  } catch (error) {
    console.error('Failed to retrieve customer payment method:', error);
    return null;
  }
}

/**
 * Stripeから支払い方法情報を取得する
 *
 * フロー:
 * 1. サブスクリプションから顧客IDと最新インボイスIDを取得
 * 2. インボイスのdefault_payment_methodから支払い方法IDを取得
 * 3. 顧客IDと支払い方法IDを使用してPaymentMethodを取得
 *
 * フォールバック:
 * - インボイスのdefault_payment_methodがない場合、payments経由で取得
 * - それでもない場合、顧客の支払い方法一覧から取得
 */
async function getSubscriptionDetailFromStripe(
  tenantId: string,
  platformSubscriptionId: string
): Promise<SubscriptionDetailInfo> {
  const emptyResult: SubscriptionDetailInfo = {
    paymentMethod: null,
    priceInfo: null,
  };

  try {
    const apiKey = await getStripeApiKey(tenantId);
    if (!apiKey) {
      console.log('Stripe API key not available');
      return emptyResult;
    }

    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 1. サブスクリプション情報を取得（価格情報も展開）
    const subscription = await stripe.subscriptions.retrieve(
      platformSubscriptionId,
      { expand: ['items.data.price'] }
    );

    // 2. 価格情報を抽出
    let priceInfo: PriceInfo | null = null;
    const priceItem = subscription.items.data[0]?.price;
    if (priceItem) {
      priceInfo = {
        amount: priceItem.unit_amount || 0,
        currency: (priceItem.currency || 'jpy').toUpperCase(),
        interval: priceItem.recurring?.interval || 'month',
      };
      console.log('Extracted price info from subscription:', priceInfo);
    }

    // 3. 支払い方法情報を取得
    const customerId = getCustomerId(subscription.customer);
    if (!customerId) {
      console.log('No customer ID found on subscription');
      return { paymentMethod: null, priceInfo };
    }

    console.log('Subscription info:', {
      customerId,
      latestInvoiceId: extractId(subscription.latest_invoice),
      defaultPaymentMethodId: extractId(subscription.default_payment_method),
    });

    // 3a. サブスクリプションのdefault_payment_methodを試す
    const subscriptionPaymentMethodId = extractId(
      subscription.default_payment_method
    );
    if (subscriptionPaymentMethodId) {
      const pm = await retrieveCustomerPaymentMethod(
        stripe,
        customerId,
        subscriptionPaymentMethodId
      );
      if (pm) {
        console.log('Using subscription.default_payment_method');
        const result = extractCardFromPaymentMethod(pm);
        if (result) return { paymentMethod: result, priceInfo };
      }
    }

    // 3b. インボイスから支払い方法を取得
    const invoiceId = extractId(subscription.latest_invoice);
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['payments.data.payment.payment_intent'],
      });

      console.log('Invoice info:', {
        invoiceId: invoice.id,
        defaultPaymentMethodId: extractId(invoice.default_payment_method),
        paymentsCount: invoice.payments?.data?.length ?? 0,
      });

      // 3b-1. インボイスのdefault_payment_methodを試す
      const invoicePaymentMethodId = extractId(invoice.default_payment_method);
      if (invoicePaymentMethodId) {
        const pm = await retrieveCustomerPaymentMethod(
          stripe,
          customerId,
          invoicePaymentMethodId
        );
        if (pm) {
          console.log('Using invoice.default_payment_method');
          const result = extractCardFromPaymentMethod(pm);
          if (result) return { paymentMethod: result, priceInfo };
        }
      }

      // 3b-2. インボイスのpayments経由でpayment_intent.payment_methodを取得
      const firstPayment = invoice.payments?.data?.[0];
      if (firstPayment?.payment?.payment_intent) {
        const paymentIntentId = extractId(firstPayment.payment.payment_intent);
        if (paymentIntentId) {
          const paymentIntent =
            await stripe.paymentIntents.retrieve(paymentIntentId);
          const paymentMethodId = extractId(paymentIntent.payment_method);
          if (paymentMethodId) {
            const pm = await retrieveCustomerPaymentMethod(
              stripe,
              customerId,
              paymentMethodId
            );
            if (pm) {
              console.log(
                'Using invoice.payments.payment.payment_intent.payment_method'
              );
              const result = extractCardFromPaymentMethod(pm);
              if (result) return { paymentMethod: result, priceInfo };
            }
          }
        }
      }
    }

    // 4. 顧客の支払い方法一覧から最新のカードを取得（最終フォールバック）
    console.log('Trying to list customer payment methods as fallback');
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 1,
    });

    if (paymentMethods.data.length > 0) {
      console.log('Using customer payment method from list');
      const result = extractCardFromPaymentMethod(paymentMethods.data[0]);
      if (result) return { paymentMethod: result, priceInfo };
    }

    console.log('No payment method found from any source');
    return { paymentMethod: null, priceInfo };
  } catch (error) {
    console.error('Failed to fetch subscription detail from Stripe:', error);
    return emptyResult;
  }
}

/**
 * プラン適用の優先順位を決定する
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

/**
 * 最も優先度の高いプラン適用を選択する
 */
function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  // 優先順位でソート（高い順）
  const sorted = [...applications].sort((a, b) => {
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    // 同じ優先度の場合は作成日時が新しい方を優先
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
  console.log('Get Current Subscription API request received');

  try {
    // 1. 認証確認（CognitoトークンからユーザIDとテナントIDを取得）
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    console.log('Request from user:', { tenantId, userId });

    // 2. ユーザのプラン適用情報を取得
    let applications: UserPlanApplication[];
    try {
      applications = await invokeDataAccessFunction<UserPlanApplication[]>(
        event,
        'user-plan-application',
        'findActiveByUserId',
        { userId }
      );
    } catch (error) {
      console.error('Error fetching user plan applications:', error);

      // データアクセスエラーの場合
      return internalServerError500Response({
        message: 'プラン適用情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 3. 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      // ステータスチェック
      if (
        !['active', 'scheduled_termination'].includes(app.application_status)
      ) {
        return false;
      }

      // 有効期限チェック
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }

      // 有効開始日チェック
      const validFrom = new Date(app.valid_from);
      if (validFrom > now) {
        return false;
      }

      return true;
    });

    console.log(`Found ${activeApplications.length} active plan applications`);

    // 4. プラン適用が存在しない場合はエラーを返す（デフォルトプランへのフォールバックなし）
    if (activeApplications.length === 0) {
      return notFound404Response({
        message: '有効なプランが見つかりません',
        code: 'NO_PLAN_FOUND',
        details: {
          userId,
          message: 'ユーザに適用されているプランが存在しません',
        },
      });
    }

    // 5. 最も優先度の高いプラン適用を選択
    const selectedApplication =
      selectHighestPriorityApplication(activeApplications);

    if (!selectedApplication) {
      return notFound404Response({
        message: '有効なプランが見つかりません',
        code: 'NO_PLAN_FOUND',
        details: undefined,
      });
    }

    console.log('Selected plan application:', {
      applicationId: selectedApplication.application_id,
      planId: selectedApplication.plan_id,
      source: selectedApplication.application_source,
      sourceId: selectedApplication.application_source_id,
      status: selectedApplication.application_status,
      validFrom: selectedApplication.valid_from,
      validUntil: selectedApplication.valid_until,
    });

    // 6. プランの詳細情報を取得
    let plan: Plan;
    try {
      const fetchedPlan = await invokeDataAccessFunction<Plan | null>(
        event,
        'plan',
        'findById',
        { id: selectedApplication.plan_id }
      );

      if (!fetchedPlan) {
        throw new Error(`Plan not found: ${selectedApplication.plan_id}`);
      }

      plan = fetchedPlan;
    } catch (error) {
      console.error('Error fetching plan details:', error);

      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'PLAN_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 7. サブスクリプション情報を取得（ソースがsubscriptionの場合）
    let subscription: Subscription | null = null;
    let nextBillingDate: string | null = null;
    let cancelAtPeriodEnd = false;
    let serviceEndDate: string | null = null;

    console.log('Checking subscription info:', {
      applicationSource: selectedApplication.application_source,
      applicationSourceId: selectedApplication.application_source_id,
      shouldFetchSubscription:
        selectedApplication.application_source === 'subscription' &&
        !!selectedApplication.application_source_id,
    });

    if (
      selectedApplication.application_source === 'subscription' &&
      selectedApplication.application_source_id
    ) {
      try {
        console.log('Fetching subscription by ID:', {
          subscriptionId: selectedApplication.application_source_id,
        });

        const fetchedSubscription =
          await invokeDataAccessFunction<Subscription | null>(
            event,
            'subscription',
            'findById',
            { subscriptionId: selectedApplication.application_source_id }
          );

        console.log('Subscription fetch result:', {
          found: !!fetchedSubscription,
          subscriptionId: fetchedSubscription?.subscription_id,
        });

        if (fetchedSubscription) {
          subscription = fetchedSubscription;

          console.log('Subscription details:', {
            subscriptionId: subscription.subscription_id,
            status: subscription.subscription_status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodEnd: subscription.current_period_end,
          });

          // 次回請求日の設定
          if (subscription.cancel_at_period_end) {
            // 解約予定の場合、次回請求はない
            nextBillingDate = null;
            cancelAtPeriodEnd = true;
            // Lambda間のJSONシリアライゼーションで既に文字列になっている可能性があるため、
            // 文字列として扱うか、必要に応じてDate型に変換
            serviceEndDate =
              typeof subscription.current_period_end === 'string'
                ? subscription.current_period_end
                : new Date(subscription.current_period_end).toISOString();
          } else {
            // 通常のサブスクリプションの場合
            nextBillingDate =
              typeof subscription.current_period_end === 'string'
                ? subscription.current_period_end
                : new Date(subscription.current_period_end).toISOString();
          }
        } else {
          console.warn('No subscription found for application_source_id:', {
            applicationSourceId: selectedApplication.application_source_id,
          });
        }
      } catch (error) {
        console.error('Error fetching subscription details:', error);
        // サブスクリプション情報の取得失敗は警告ログのみで続行
      }
    } else {
      console.log('Skipping subscription fetch:', {
        reason:
          selectedApplication.application_source !== 'subscription'
            ? 'application_source is not subscription'
            : 'application_source_id is null',
      });
    }

    // 8. 支払い方法情報と価格情報を取得（Stripeの場合のみ）
    let subscriptionDetail: SubscriptionDetailInfo = {
      paymentMethod: null,
      priceInfo: null,
    };
    if (
      subscription &&
      subscription.platform_type === 'stripe' &&
      subscription.platform_subscription_id
    ) {
      console.log('Fetching subscription detail from Stripe:', {
        platformSubscriptionId: subscription.platform_subscription_id,
      });
      subscriptionDetail = await getSubscriptionDetailFromStripe(
        tenantId,
        subscription.platform_subscription_id
      );
    }

    // 9. 生年月日を取得（Cognito ユーザー属性から直接取得）
    const birthdate = getBirthdateFromClaims(event);

    // 10. 価格情報の決定（internalプランは0円、Stripeの場合はサブスクリプションから取得）
    let amount = 0;
    let currency = 'JPY';
    let interval = 'month';
    if (plan.platform_type !== 'internal' && subscriptionDetail.priceInfo) {
      amount = subscriptionDetail.priceInfo.amount;
      currency = subscriptionDetail.priceInfo.currency;
      interval = subscriptionDetail.priceInfo.interval;
    }

    // 11. レスポンスの構築
    const response: CurrentPlanResponse = {
      planId: plan.plan_id,
      planName: plan.internal_name,
      displayName: plan.display_name,
      status: selectedApplication.application_status,
      subscriptionId: subscription?.subscription_id || null,
      platformType: subscription?.platform_type || null,
      currentPeriodStart: subscription?.current_period_start
        ? typeof subscription.current_period_start === 'string'
          ? subscription.current_period_start
          : new Date(subscription.current_period_start).toISOString()
        : null,
      currentPeriodEnd: subscription?.current_period_end
        ? typeof subscription.current_period_end === 'string'
          ? subscription.current_period_end
          : new Date(subscription.current_period_end).toISOString()
        : null,
      nextBillingDate,
      cancelAtPeriodEnd,
      serviceEndDate,
      subscribedAt: subscription?.created_at
        ? typeof subscription.created_at === 'string'
          ? subscription.created_at
          : new Date(subscription.created_at).toISOString()
        : null,
      paymentMethod: subscriptionDetail.paymentMethod,
      amount,
      currency,
      interval,
      birthdate,
    };

    console.log('Returning current plan information:', {
      planId: response.planId,
      planName: response.planName,
      status: response.status,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in getCurrentSubscription:', error);

    // 認証エラーの場合
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    // その他の予期しないエラー
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
