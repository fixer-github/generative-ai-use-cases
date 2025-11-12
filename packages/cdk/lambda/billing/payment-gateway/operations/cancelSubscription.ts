import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType } from '../repositories/types';
import { google } from 'googleapis';
import { getTenantId } from '../../../utils/tenantUtils';

/**
 * リクエストボディの型
 */
interface CancelSubscriptionRequest {
  platformType: PlatformType;
  subscriptionId: string;
  cancelImmediately: boolean; // 即時キャンセルか期限終了時キャンセルか
  // Google固有のパラメータ
  packageName?: string;
  purchaseToken?: string;
}

/**
 * レスポンスボディの型
 */
interface CancelSubscriptionResponse {
  success: boolean;
  canceledAt: string;
  serviceEndDate: string; // サービス終了日
}

/**
 * シークレットのキャッシュ
 */
const secretsCache: Record<string, any> = {};

/**
 * Secrets Managerからシークレットを取得する
 */
async function getSecret(secretName: string): Promise<any> {
  if (secretsCache[secretName]) {
    return secretsCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  secretsCache[secretName] = secret;

  return secret;
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Cancel subscription request received');

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

    const requestBody: CancelSubscriptionRequest = JSON.parse(event.body);
    const {
      platformType,
      subscriptionId,
      cancelImmediately,
      packageName,
      purchaseToken,
    } = requestBody;

    console.log('Cancel subscription request:', {
      platformType,
      subscriptionId,
      tenantId,
    });

    // 3. プラットフォームごとにキャンセル処理を実行
    let result;
    switch (platformType) {
      case 'stripe':
        result = await cancelStripeSubscription(
          subscriptionId,
          cancelImmediately,
          tenantId
        );
        break;

      case 'apple':
        // Appleの場合、サーバー側からのキャンセルはできない
        // ユーザーがApp Storeの設定から解約する必要がある
        return {
          statusCode: 400,
          body: JSON.stringify({
            error:
              'Apple subscriptions cannot be canceled server-side. Users must cancel through App Store settings.',
          }),
        };

      case 'google':
        if (!packageName || !purchaseToken) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              error:
                'packageName and purchaseToken are required for Google subscriptions',
            }),
          };
        }
        result = await cancelGoogleSubscription(
          subscriptionId,
          packageName,
          purchaseToken,
          tenantId
        );
        break;

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unsupported platform type: ${platformType}`,
          }),
        };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error canceling subscription:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

/**
 * Stripeのサブスクリプションをキャンセルする
 */
async function cancelStripeSubscription(
  subscriptionId: string,
  cancelImmediately: boolean,
  tenantId: string
): Promise<CancelSubscriptionResponse> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2025-10-29.clover' });

  if (cancelImmediately) {
    // 即時キャンセル
    const canceledSubscription =
      await stripe.subscriptions.cancel(subscriptionId);

    return {
      success: true,
      canceledAt: new Date(
        canceledSubscription.canceled_at! * 1000
      ).toISOString(),
      serviceEndDate: new Date(
        canceledSubscription.canceled_at! * 1000
      ).toISOString(),
    };
  } else {
    // 期限終了時にキャンセル（有効期限まで利用可能）
    const updatedSubscription = await stripe.subscriptions.update(
      subscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    // Stripe API Clover系では、current_period_endはSubscriptionItemレベルに移行
    const subscriptionItem = updatedSubscription.items.data[0];

    return {
      success: true,
      canceledAt: new Date().toISOString(),
      serviceEndDate: new Date(
        subscriptionItem.current_period_end * 1000
      ).toISOString(),
    };
  }
}

/**
 * Googleのサブスクリプションをキャンセルする
 */
async function cancelGoogleSubscription(
  subscriptionId: string,
  packageName: string,
  purchaseToken: string,
  tenantId: string
): Promise<CancelSubscriptionResponse> {
  const secretName = `${tenantId}/billing/google`;
  const secret = await getSecret(secretName);

  // Google認証クライアントを作成
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(secret.serviceAccountKey),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const androidPublisher = google.androidpublisher({
    version: 'v3',
    auth: auth,
  });

  // サブスクリプションをキャンセル
  await androidPublisher.purchases.subscriptions.cancel({
    packageName: packageName,
    subscriptionId: subscriptionId,
    token: purchaseToken,
  });

  // キャンセル後の情報を取得
  const response = await androidPublisher.purchases.subscriptions.get({
    packageName: packageName,
    subscriptionId: subscriptionId,
    token: purchaseToken,
  });

  const subscription = response.data;

  const expiryTime = subscription.expiryTimeMillis
    ? new Date(parseInt(subscription.expiryTimeMillis, 10))
    : new Date();

  return {
    success: true,
    canceledAt: new Date().toISOString(),
    serviceEndDate: expiryTime.toISOString(),
  };
}
