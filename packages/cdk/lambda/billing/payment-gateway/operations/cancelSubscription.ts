import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType } from '../repositories/types';
import { google } from 'googleapis';

/**
 * Lambda関数ハンドラーのイベント型
 */
interface CancelSubscriptionEvent {
  platformType: PlatformType;
  subscriptionId: string;
  cancelImmediately: boolean; // 即時キャンセルか期限終了時キャンセルか
  tenantId: string;
  // Google固有のパラメータ
  packageName?: string;
  purchaseToken?: string;
}

/**
 * Lambda関数ハンドラーのレスポンス型
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
  event: CancelSubscriptionEvent
): Promise<CancelSubscriptionResponse> {
  console.log('Cancel subscription request:', event);

  try {
    const { platformType, subscriptionId, cancelImmediately, tenantId } = event;

    switch (platformType) {
      case 'stripe':
        return cancelStripeSubscription(
          subscriptionId,
          cancelImmediately,
          tenantId
        );

      case 'apple':
        // Appleの場合、サーバー側からのキャンセルはできない
        // ユーザーがApp Storeの設定から解約する必要がある
        throw new Error(
          'Apple subscriptions cannot be canceled server-side. Users must cancel through App Store settings.'
        );

      case 'google':
        return cancelGoogleSubscription(
          subscriptionId,
          event.packageName!,
          event.purchaseToken!,
          tenantId
        );

      default:
        throw new Error(`Unsupported platform type: ${platformType}`);
    }
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
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

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2024-11-20.acacia' });

  if (cancelImmediately) {
    // 即時キャンセル
    const canceledSubscription = await stripe.subscriptions.cancel(
      subscriptionId
    );

    return {
      success: true,
      canceledAt: new Date(canceledSubscription.canceled_at! * 1000).toISOString(),
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

    return {
      success: true,
      canceledAt: new Date().toISOString(),
      serviceEndDate: new Date(
        updatedSubscription.current_period_end * 1000
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
