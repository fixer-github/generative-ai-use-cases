/**
 * Payment Method Update Session Creation API
 *
 * ユーザがサブスクリプションの支払い方法を更新するための
 * Stripe Checkout Session（setup mode）を作成します。
 *
 * Customer Portalとは異なり、このAPIで作成されたセッションを完了すると、
 * 即座にサブスクリプションのdefault_payment_methodが更新されます。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Subscription } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  notFound404Response,
  forbidden403Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

/**
 * リクエストボディの型
 */
interface CreatePaymentMethodUpdateSessionRequest {
  subscriptionId: string; // 内部サブスクリプションID
  returnUrl: string; // Embedded Checkout完了後のリダイレクトURL
}

/**
 * レスポンスボディの型
 */
interface CreatePaymentMethodUpdateSessionResponse {
  url: string; // Checkout URL（リダイレクト用）
  session_id: string; // セッションID
  client_secret: string; // Embedded Checkout用
  publishable_key: string; // Stripe Publishable Key（Embedded Checkout用）
}

/**
 * Stripe認証情報の型
 */
interface StripeCredentials {
  apiKey: string;
  publishableKey: string;
}

/**
 * リクエストボディをパースする
 */
function parseRequestBody(
  body: string
): CreatePaymentMethodUpdateSessionRequest | { error: true } {
  try {
    return JSON.parse(body);
  } catch {
    return { error: true };
  }
}

/**
 * シークレットのキャッシュ
 */
const stripeCredentialsCache: Record<string, StripeCredentials> = {};

/**
 * Secrets ManagerからStripe認証情報を取得する
 */
async function getStripeCredentials(tenantId: string): Promise<StripeCredentials> {
  if (stripeCredentialsCache[tenantId]) {
    return stripeCredentialsCache[tenantId];
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
    const credentials: StripeCredentials = {
      apiKey: secret.apiKey,
      publishableKey: secret.publishableKey,
    };
    stripeCredentialsCache[tenantId] = credentials;

    return credentials;
  } catch (error) {
    console.error('Failed to retrieve Stripe credentials:', error);
    throw new Error('Failed to retrieve payment configuration');
  }
}

/**
 * Stripeサブスクリプションから顧客IDを取得する
 */
async function getStripeCustomerId(
  stripe: Stripe,
  platformSubscriptionId: string
): Promise<string> {
  const subscription = await stripe.subscriptions.retrieve(platformSubscriptionId);

  const customer = subscription.customer;
  if (!customer) {
    throw new Error('No customer found on subscription');
  }

  if (typeof customer === 'string') {
    return customer;
  }

  if ('id' in customer) {
    return customer.id;
  }

  throw new Error('Unable to extract customer ID from subscription');
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Create Payment Method Update Session request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const userId = getUsername(event);
    const tenantId = getTenantId(event);

    if (!userId || userId === 'unknown' || !tenantId) {
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

    const parseResult = parseRequestBody(event.body);
    if ('error' in parseResult) {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
        details: undefined,
      });
    }

    const { subscriptionId, returnUrl } = parseResult;

    if (!subscriptionId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'subscriptionId',
          reason: 'subscriptionIdは必須です',
        },
      });
    }

    if (!returnUrl) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'returnUrl',
          reason: 'returnUrlは必須です',
        },
      });
    }

    console.log('Creating payment method update session for subscription:', subscriptionId);

    // 3. サブスクリプション情報を取得
    const subscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'findById',
      { subscriptionId }
    );

    if (!subscription) {
      console.error('Subscription not found:', subscriptionId);
      return notFound404Response({
        message: '指定されたサブスクリプションが見つかりません',
        code: 'SUBSCRIPTION_NOT_FOUND',
        details: {
          subscriptionId,
        },
      });
    }

    // 4. サブスクリプションの所有者確認
    if (subscription.user_id !== userId) {
      console.error('Subscription does not belong to user:', {
        subscriptionUserId: subscription.user_id,
        requestUserId: userId,
      });
      return forbidden403Response({
        message: 'このサブスクリプションにアクセスする権限がありません',
        code: 'FORBIDDEN',
        details: undefined,
      });
    }

    // 5. サブスクリプションのステータス確認
    const activeStatuses = ['active', 'past_due', 'scheduled_cancellation'];
    if (!activeStatuses.includes(subscription.subscription_status)) {
      console.error('Subscription is not active:', {
        subscriptionId,
        status: subscription.subscription_status,
      });
      return badRequest400Response({
        message: 'このサブスクリプションは現在有効ではありません',
        code: 'SUBSCRIPTION_NOT_ACTIVE',
        details: {
          subscriptionId,
          status: subscription.subscription_status,
        },
      });
    }

    // 6. プラットフォームタイプ確認
    if (subscription.platform_type !== 'stripe') {
      console.error('Invalid platform type:', {
        subscriptionId,
        platformType: subscription.platform_type,
      });
      return badRequest400Response({
        message: 'この操作はStripeのサブスクリプションでのみ利用可能です',
        code: 'INVALID_PLATFORM',
        details: {
          subscriptionId,
          platformType: subscription.platform_type,
        },
      });
    }

    console.log('Subscription validation successful:', {
      subscriptionId: subscription.subscription_id,
      platformSubscriptionId: subscription.platform_subscription_id,
      status: subscription.subscription_status,
    });

    // 7. Stripe認証情報を取得
    const credentials = await getStripeCredentials(tenantId);
    const stripe = new Stripe(credentials.apiKey, { apiVersion: '2025-10-29.clover' });

    // 8. Stripe顧客IDを取得
    const customerId = await getStripeCustomerId(
      stripe,
      subscription.platform_subscription_id
    );

    console.log('Stripe customer ID retrieved:', { customerId });

    console.log('Return URL configured:', { returnUrl });

    // 10. Checkout Sessionを作成（setup mode）
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      ui_mode: 'embedded',
      customer: customerId,
      payment_method_types: ['card'],
      return_url: returnUrl,
      redirect_on_completion: 'if_required',
      setup_intent_data: {
        metadata: {
          subscription_id: subscription.subscription_id,
          platform_subscription_id: subscription.platform_subscription_id,
          user_id: userId,
          tenant_id: tenantId,
        },
      },
      metadata: {
        subscription_id: subscription.subscription_id,
        platform_subscription_id: subscription.platform_subscription_id,
        user_id: userId,
        purpose: 'update_payment_method',
      },
      locale: 'ja',
    });

    console.log('Payment Method Update Checkout Session created:', session.id);

    // 11. レスポンスを返す
    const response: CreatePaymentMethodUpdateSessionResponse = {
      url: session.url || '',
      session_id: session.id,
      client_secret: session.client_secret || '',
      publishable_key: credentials.publishableKey,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error creating payment method update session:', error);

    // Stripeのエラーを適切に処理
    if (error instanceof Stripe.errors.StripeError) {
      return badRequest400Response({
        message: error.message,
        code: 'STRIPE_ERROR',
        details: {
          type: error.type,
          code: error.code,
        },
      });
    }

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
