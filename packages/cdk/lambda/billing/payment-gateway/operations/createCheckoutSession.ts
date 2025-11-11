import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Lambda関数ハンドラーのイベント型
 */
interface CreateCheckoutSessionEvent {
  userId: string;
  priceId: string; // Stripeの価格ID
  successUrl: string;
  cancelUrl: string;
  tenantId: string;
}

/**
 * Lambda関数ハンドラーのレスポンス型
 */
interface CreateCheckoutSessionResponse {
  sessionId: string;
  url: string;
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
  event: CreateCheckoutSessionEvent
): Promise<CreateCheckoutSessionResponse> {
  console.log('Create Checkout Session request:', {
    userId: event.userId,
    priceId: event.priceId,
    tenantId: event.tenantId,
  });

  try {
    const { userId, priceId, successUrl, cancelUrl, tenantId } = event;

    // Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2024-11-20.acacia' });

    // ユーザー情報を取得
    const userInfo = await getUserInfo(userId);

    // Checkout Sessionを作成
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
      sessionId: session.id,
      url: session.url!,
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}
