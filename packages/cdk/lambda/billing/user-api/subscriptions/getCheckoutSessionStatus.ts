/**
 * Get Checkout Session Status API
 *
 * Stripe Checkout Sessionの状態を取得するAPI。
 * 支払い完了後のリダイレクトページで使用されます。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';

/**
 * レスポンスボディの型
 */
interface CheckoutSessionStatusResponse {
  status: 'complete' | 'open' | 'expired';
  payment_status?: string;
  plan_name?: string;
  amount?: number;
  currency?: string;
  customer_email?: string;
}

/**
 * エラーレスポンスの型
 */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
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
  console.log('User API: Get Checkout Session Status request received');

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

    // 2. パスパラメータからセッションIDを取得
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: 'セッションIDが指定されていません',
          },
        } as ErrorResponse),
      };
    }

    console.log('Retrieving checkout session:', sessionId);

    // 3. Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 4. Checkout Sessionを取得
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    // 5. セッションのメタデータからユーザIDを確認（セキュリティチェック）
    if (session.metadata?.userId !== userId) {
      console.error('User ID mismatch:', {
        sessionUserId: session.metadata?.userId,
        requestUserId: userId,
      });
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'このセッションへのアクセス権限がありません',
          },
        } as ErrorResponse),
      };
    }

    // 6. レスポンスを構築
    const lineItem = session.line_items?.data[0];
    const price = lineItem?.price;
    const product = price?.product as Stripe.Product | undefined;

    const response: CheckoutSessionStatusResponse = {
      status: session.status as 'complete' | 'open' | 'expired',
      payment_status: session.payment_status ?? undefined,
      plan_name: product?.name,
      amount: lineItem?.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      customer_email: session.customer_details?.email ?? undefined,
    };

    console.log('Session status retrieved:', {
      sessionId,
      status: response.status,
      paymentStatus: response.payment_status,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error retrieving checkout session status:', error);

    // Stripeのエラーを適切に処理
    if (error instanceof Stripe.errors.StripeError) {
      // セッションが見つからない場合
      if (error.code === 'resource_missing') {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: '指定されたセッションが見つかりません',
            },
          } as ErrorResponse),
        };
      }

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
