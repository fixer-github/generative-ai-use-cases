import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getTenantId } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import { getOrCreateStripeCustomerId } from '../utils/stripeCustomerManager';

/**
 * リクエストボディの型
 */
interface CreateCheckoutSessionRequest {
  userId: string;
  planId: string; // プランID
  priceId: string; // Stripeの価格ID
  successUrl: string;
  cancelUrl: string;
}

/**
 * シークレットのキャッシュ
 */
let stripeApiKeyCache: string | null = null;

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache) {
    return stripeApiKeyCache;
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  stripeApiKeyCache = secret.apiKey;

  return stripeApiKeyCache!;
}

/**
 * Cognitoからユーザー情報を取得する
 */
async function getUserInfo(userId: string): Promise<{ email: string }> {
  const userPoolId = process.env.USER_POOL_ID;

  if (!userPoolId) {
    throw new Error('USER_POOL_ID is not set');
  }

  const client = new CognitoIdentityProviderClient({});
  const command = new AdminGetUserCommand({
    UserPoolId: userPoolId,
    Username: userId,
  });

  const response = await client.send(command);

  const emailAttribute = response.UserAttributes?.find(
    (attr) => attr.Name === 'email'
  );

  if (!emailAttribute?.Value) {
    throw new Error(`Email not found for user: ${userId}`);
  }

  return {
    email: emailAttribute.Value,
  };
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Create Checkout Session request received');

  try {
    // 1. Cognitoの認証情報からテナントIDを取得
    const tenantId = getTenantId(event);

    // 2. リクエストボディを取得
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const requestBody: CreateCheckoutSessionRequest = JSON.parse(event.body);
    const { userId, planId, priceId, successUrl, cancelUrl } = requestBody;

    console.log('Create Checkout Session request:', {
      userId,
      planId,
      priceId,
      tenantId,
    });

    // 3. プランの存在確認とpriceIdの対応チェック
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
        body: JSON.stringify({
          error: 'Plan not found',
          message: `指定されたプランが見つかりません: ${planId}`,
        }),
      };
    }

    // プランのplatform_typeがstripeであることを確認
    if (plan.platform_type !== 'stripe') {
      console.error('Invalid platform type:', {
        planId,
        platformType: plan.platform_type,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid platform type',
          message: `このプランはStripe決済に対応していません: ${plan.platform_type}`,
        }),
      };
    }

    // platform_product_idとpriceIdが一致するかチェック
    if (plan.platform_product_id !== priceId) {
      console.error('PriceId mismatch:', {
        planId,
        expectedPriceId: plan.platform_product_id,
        providedPriceId: priceId,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'PriceId mismatch',
          message: 'プランIDと価格IDが対応していません',
          details: {
            planId,
            expectedPriceId: plan.platform_product_id,
            providedPriceId: priceId,
          },
        }),
      };
    }

    // プランが購入可能な状態かチェック
    if (plan.status === 'deprecated') {
      console.error('Plan is deprecated:', planId);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Plan deprecated',
          message: 'このプランは廃止されており、購入できません',
        }),
      };
    }

    console.log('Plan validation successful:', {
      planId: plan.plan_id,
      priceId: plan.platform_product_id,
      status: plan.status,
    });

    // 4. Stripe APIキーを取得（テナント専用）
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 5. ユーザー情報を取得
    const userInfo = await getUserInfo(userId);

    // 6. Stripe Customer IDを取得または作成
    const customerId = await getOrCreateStripeCustomerId(
      event,
      userId,
      userInfo.email,
      tenantId
    );

    // 7. Checkout Sessionを作成
    const session = await stripe.checkout.sessions.create({
      customer: customerId, // customer_emailではなくcustomer_idを使用
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
      // サブスクリプションにもmetadataを設定（領収書メールでplanIdを取得するため）
      subscription_data: {
        metadata: {
          userId,
          tenantId,
          planId,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      payment_method_types: ['card'],
    });

    console.log('Checkout Session created:', session.id);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url!,
      }),
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
