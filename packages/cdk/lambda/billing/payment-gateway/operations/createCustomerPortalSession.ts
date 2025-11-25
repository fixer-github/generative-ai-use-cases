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
import {
  getOrCreateStripeCustomerId,
  getExistingStripeCustomerId,
} from '../utils/stripeCustomerManager';

/**
 * リクエストボディの型
 */
interface CreateCustomerPortalSessionRequest {
  userId: string;
  returnUrl: string;
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
 * Stripe Customer Portalセッションを作成する
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Create Customer Portal Session request received');

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

    const requestBody: CreateCustomerPortalSessionRequest = JSON.parse(
      event.body
    );
    const { userId, returnUrl } = requestBody;

    console.log('Create Customer Portal Session request:', {
      userId,
      tenantId,
      returnUrl,
    });

    // 3. 既存のStripe Customer IDを確認
    // Customer Portalの利用時は既存顧客のみアクセス可能とする場合
    // （新規作成せずに既存顧客のみに制限したい場合はこちらを使用）
    let customerId = await getExistingStripeCustomerId(event, userId, tenantId);

    if (!customerId) {
      // Customer IDが存在しない場合は、ユーザー情報を取得して新規作成
      console.log(
        'No existing Stripe Customer ID found, creating new customer'
      );
      const userInfo = await getUserInfo(userId);
      customerId = await getOrCreateStripeCustomerId(
        event,
        userId,
        userInfo.email,
        tenantId
      );
    }

    // 4. Stripe APIキーを取得（テナント専用）
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 5. Customer Portal Sessionを作成
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      // Portalで許可される操作を指定できます
      // 例: サブスクリプションのキャンセル、支払い方法の更新など
      // configuration: 'bpc_xxxxx', // 事前に作成したPortal設定IDを指定可能
    });

    console.log('Customer Portal Session created:', {
      sessionId: portalSession.id,
      customerId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: portalSession.url,
      }),
    };
  } catch (error) {
    console.error('Error creating customer portal session:', error);

    // エラーの種類に応じた適切なレスポンスを返す
    if (error instanceof Error) {
      if (error.message.includes('No such customer')) {
        return {
          statusCode: 404,
          body: JSON.stringify({
            error: 'Customer not found',
            message:
              'まだサブスクリプションの契約履歴がありません。最初にプランを契約してください。',
          }),
        };
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}