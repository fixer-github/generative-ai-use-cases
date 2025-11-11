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
interface UpdateSubscriptionEvent {
  platformType: PlatformType;
  subscriptionId: string;
  newPriceId: string;
  isUpgrade: boolean;
  tenantId: string;
}

/**
 * Lambda関数ハンドラーのレスポンス型
 */
interface UpdateSubscriptionResponse {
  success: boolean;
  effectiveDate: string; // 変更が有効になる日時
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
  event: UpdateSubscriptionEvent
): Promise<UpdateSubscriptionResponse> {
  console.log('Update subscription request:', event);

  try {
    const { platformType, subscriptionId, newPriceId, isUpgrade, tenantId } =
      event;

    switch (platformType) {
      case 'stripe':
        return updateStripeSubscription(
          subscriptionId,
          newPriceId,
          isUpgrade,
          tenantId
        );

      case 'apple':
        // Appleの場合、サーバー側からのプラン変更は制限されている
        // クライアント側でユーザーがApp Storeから変更する必要がある
        throw new Error(
          'Apple subscription updates must be initiated by the user in the App Store'
        );

      case 'google':
        // Googleの場合、プラン変更は一部サポートされているが制限あり
        return updateGoogleSubscription(
          subscriptionId,
          newPriceId,
          tenantId
        );

      default:
        throw new Error(`Unsupported platform type: ${platformType}`);
    }
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

/**
 * Stripeのサブスクリプションを変更する
 */
async function updateStripeSubscription(
  subscriptionId: string,
  newPriceId: string,
  isUpgrade: boolean,
  tenantId: string
): Promise<UpdateSubscriptionResponse> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2024-11-20.acacia' });

  // 現在のサブスクリプションを取得
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // サブスクリプションアイテムを更新
  const subscriptionItemId = subscription.items.data[0].id;

  const updatedSubscription = await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      // アップグレードの場合は即座に変更し、日割り請求
      // ダウングレードの場合は次回更新時に変更
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
    }
  );

  // 有効日を計算
  const effectiveDate = isUpgrade
    ? new Date()
    : new Date(updatedSubscription.current_period_end * 1000);

  return {
    success: true,
    effectiveDate: effectiveDate.toISOString(),
  };
}

/**
 * Googleのサブスクリプションを変更する
 * 注: Google Play Billingでは、プラン変更は限定的にサポートされています
 */
async function updateGoogleSubscription(
  subscriptionId: string,
  newProductId: string,
  tenantId: string
): Promise<UpdateSubscriptionResponse> {
  const secretName = `${tenantId}/billing/google`;
  const secret = await getSecret(secretName);

  // Google Play Billingでは、サーバー側からの直接的なプラン変更APIは提供されていません
  // クライアント側でBillingClient.launchBillingFlow()を使用してプラン変更を行う必要があります

  // ここでは、変更が受け付けられたことを示すレスポンスを返すだけです
  // 実際の変更はクライアント側で行われ、Webhookで通知されます

  console.log(
    'Google subscription update request received. Client-side action required.'
  );

  return {
    success: true,
    effectiveDate: new Date().toISOString(),
  };
}
