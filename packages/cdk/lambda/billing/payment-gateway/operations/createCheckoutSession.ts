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

/**
 * リクエストボディの型
 */
interface CreateCheckoutSessionRequest {
  userId: string;
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
    const { userId, priceId, successUrl, cancelUrl } = requestBody;

    console.log('Create Checkout Session request:', {
      userId,
      priceId,
      tenantId,
    });

    // 3. Stripe APIキーを取得（テナント専用）
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 4. ユーザー情報を取得
    const userInfo = await getUserInfo(userId);

    // 5. Checkout Sessionを作成
    const session = await stripe.checkout.sessions.create({
      customer_email: userInfo.email,
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
