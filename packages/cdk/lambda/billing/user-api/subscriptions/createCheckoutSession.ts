/**
 * User-facing Checkout Session Creation API
 *
 * ユーザ向けのCheckout Session作成API。
 * planIdのみを受け取り、Stripeの支払いセッションを作成します。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
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
interface CreateCheckoutSessionRequest {
  planId: string; // プランID
}

/**
 * レスポンスボディの型
 */
interface CreateCheckoutSessionResponse {
  client_secret: string;
  session_id: string;
}

/**
 * エラーレスポンスの型
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

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
 * リクエストヘッダーからフロントエンドのベースURLを取得する
 * Origin > Referer の優先順位で取得し、取得できない場合はエラーをスローする
 */
function getBaseUrlFromRequest(event: APIGatewayProxyEvent): string {
  const headers = event.headers;

  // Originヘッダーから取得（CORS リクエストの場合）
  const origin = headers['origin'] || headers['Origin'];
  if (origin) {
    return origin;
  }

  // Refererヘッダーから取得（フォールバック）
  const referer = headers['referer'] || headers['Referer'];
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Refererのパースに失敗した場合は続行
    }
  }

  // どちらも取得できない場合はエラー
  throw new Error('Unable to determine frontend base URL from request headers');
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Create Checkout Session request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const userId = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);

    if (!userId || !tenantId) {
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

    let requestBody: CreateCheckoutSessionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
        details: undefined,
      });
    }

    const { planId } = requestBody;

    if (!planId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'planId',
          reason: 'planIdは必須です',
        },
      });
    }

    console.log('Creating checkout session for plan:', planId);

    // 3. プラン情報を取得
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );

    if (!plan) {
      console.error('Plan not found:', planId);
      return notFound404Response({
        message: '指定されたプランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: {
          planId,
        },
      });
    }

    // 4. プランのプラットフォームタイプを確認
    if (plan.platform_type !== 'stripe') {
      console.error('Invalid platform type:', {
        planId,
        platformType: plan.platform_type,
      });
      return badRequest400Response({
        message: 'このプランはWeb版での購入に対応していません',
        code: 'INVALID_PLATFORM',
        details: {
          planId,
          platformType: plan.platform_type,
        },
      });
    }

    // 5. Stripe Price IDを取得
    const priceId = plan.platform_product_id;
    if (!priceId) {
      console.error('Price ID not configured for plan:', planId);
      return internalServerError500Response({
        message: 'プランの価格設定が正しく構成されていません',
        code: 'CONFIGURATION_ERROR',
        details: {
          planId,
        },
      });
    }

    // 6. プランのステータスを確認
    if (plan.status === 'deprecated') {
      console.error('Plan is deprecated:', planId);
      return badRequest400Response({
        message: 'このプランは廃止されており、購入できません',
        code: 'PLAN_DEPRECATED',
        details: {
          planId,
        },
      });
    }

    console.log('Plan validation successful:', {
      planId: plan.plan_id,
      priceId: plan.platform_product_id,
      status: plan.status,
    });

    // 7. Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 8. return URLを設定（Embedded Checkout用）
    const baseUrl = getBaseUrlFromRequest(event);
    const returnUrl = `${baseUrl}/billing/complete?session_id={CHECKOUT_SESSION_ID}`;

    console.log('Return URL configured:', { baseUrl, returnUrl });

    // 9. Checkout Sessionを作成（Embedded Checkout用）
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded', // Embedded Checkoutを使用
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      return_url: returnUrl, // Embedded Checkout用のreturn URL
      metadata: {
        userId,
        tenantId,
        planId,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      payment_method_types: ['card'],
      locale: 'ja', // 日本語表示
    });

    console.log('Checkout Session created:', session.id);

    // 10. レスポンスを返す
    const response: CreateCheckoutSessionResponse = {
      client_secret: session.client_secret || '', // Embedded Checkoutで使用
      session_id: session.id,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error creating checkout session:', error);

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
