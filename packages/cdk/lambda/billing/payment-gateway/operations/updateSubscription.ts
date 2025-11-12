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
interface UpdateSubscriptionRequest {
  platformType: PlatformType;
  subscriptionId: string;
  newPriceId: string;
  isUpgrade: boolean;
}

/**
 * レスポンスボディの型
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
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Update subscription request received');

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

    const requestBody: UpdateSubscriptionRequest = JSON.parse(event.body);
    const { platformType, subscriptionId, newPriceId, isUpgrade } = requestBody;

    console.log('Update subscription request:', {
      platformType,
      subscriptionId,
      tenantId,
    });

    // 3. プラットフォームごとに更新処理を実行
    let result;
    switch (platformType) {
      case 'stripe':
        result = await updateStripeSubscription(
          subscriptionId,
          newPriceId,
          isUpgrade,
          tenantId
        );
        break;

      case 'apple':
        // Appleの場合、サーバー側からのプラン変更は制限されている
        // クライアント側でユーザーがApp Storeから変更する必要がある
        return {
          statusCode: 400,
          body: JSON.stringify({
            error:
              'Apple subscription updates must be initiated by the user in the App Store',
          }),
        };

      case 'google':
        // Googleの場合、プラン変更は一部サポートされているが制限あり
        result = await updateGoogleSubscription(
          subscriptionId,
          newPriceId,
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
    console.error('Error updating subscription:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
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

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2025-10-29.clover' });

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
  // Stripe API Clover系では、current_period_endはSubscriptionItemレベルに移行
  const updatedSubscriptionItem = updatedSubscription.items.data[0];
  const effectiveDate = isUpgrade
    ? new Date()
    : new Date(updatedSubscriptionItem.current_period_end * 1000);

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
