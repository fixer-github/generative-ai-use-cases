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
  clientSecret: string;
  sessionId: string;
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
 * CORSヘッダー
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
};

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
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です',
          },
        } as ErrorResponse),
      };
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'リクエストボディが必要です',
          },
        } as ErrorResponse),
      };
    }

    let requestBody: CreateCheckoutSessionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'リクエストボディが不正なJSON形式です',
          },
        } as ErrorResponse),
      };
    }

    const { planId } = requestBody;

    if (!planId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'planId',
              reason: 'planIdは必須です',
            },
          },
        } as ErrorResponse),
      };
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
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PLAN_NOT_FOUND',
            message: '指定されたプランが見つかりません',
            details: {
              planId,
            },
          },
        } as ErrorResponse),
      };
    }

    // 4. プランのプラットフォームタイプを確認
    if (plan.platform_type !== 'stripe') {
      console.error('Invalid platform type:', {
        planId,
        platformType: plan.platform_type,
      });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PLATFORM',
            message: 'このプランはWeb版での購入に対応していません',
            details: {
              planId,
              platformType: plan.platform_type,
            },
          },
        } as ErrorResponse),
      };
    }

    // 5. Stripe Price IDを取得
    const priceId = plan.platform_product_id;
    if (!priceId) {
      console.error('Price ID not configured for plan:', planId);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'プランの価格設定が正しく構成されていません',
            details: {
              planId,
            },
          },
        } as ErrorResponse),
      };
    }

    // 6. プランのステータスを確認
    if (plan.status === 'deprecated') {
      console.error('Plan is deprecated:', planId);
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PLAN_DEPRECATED',
            message: 'このプランは廃止されており、購入できません',
            details: {
              planId,
            },
          },
        } as ErrorResponse),
      };
    }

    console.log('Plan validation successful:', {
      planId: plan.plan_id,
      priceId: plan.platform_product_id,
      status: plan.status,
    });

    // 7. Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 8. 成功/キャンセルURLを設定
    const baseUrl = process.env.FRONTEND_BASE_URL || 'https://app.example.com';
    const successUrl = `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/subscription/plans`;

    // 9. Checkout Sessionを作成
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        tenantId,
        planId,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      payment_method_types: ['card'],
      customer_creation: 'always', // 新規顧客を作成
      locale: 'ja', // 日本語表示
    });

    console.log('Checkout Session created:', session.id);

    // 10. レスポンスを返す
    const response: CreateCheckoutSessionResponse = {
      clientSecret: session.client_secret || '', // Embedded Checkoutで使用
      sessionId: session.id,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);

    // Stripeのエラーを適切に処理
    if (error instanceof Stripe.errors.StripeError) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'STRIPE_ERROR',
            message: error.message,
            details: {
              type: error.type,
              code: error.code,
            },
          },
        } as ErrorResponse),
      };
    }

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
        },
      } as ErrorResponse),
    };
  }
};
