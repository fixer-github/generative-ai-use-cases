/**
 * 内部用: サブスクリプションキャンセルLambda関数
 *
 * 統括責務のCancellation Flowから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { google } from 'googleapis';

/**
 * 入力パラメータ
 */
export interface CancelSubscriptionInput {
  /** プラットフォームタイプ */
  platform: 'stripe' | 'apple' | 'google';
  /** プラットフォーム側のサブスクリプションID（Stripe: sub_xxx, etc.） */
  platformSubscriptionId: string;
  /** 期間終了時にキャンセルするか（true: 期間終了時、false: 即座） */
  atPeriodEnd: boolean;
  /** テナントID（シークレット取得に必要） */
  tenantId: string;
  /** Google固有: パッケージ名 */
  packageName?: string;
  /** Google固有: 購入トークン */
  purchaseToken?: string;
}

/**
 * 出力パラメータ
 */
export interface CancelSubscriptionOutput {
  /** 成功フラグ */
  success: boolean;
  /** キャンセル日時 */
  canceledAt?: string;
  /** サービス終了日 */
  serviceEndDate?: string;
}

/**
 * エラークラス
 */
export class CancelSubscriptionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CancelSubscriptionError';
  }
}

/**
 * シークレットのキャッシュ
 */
const secretsCache: Record<string, Record<string, unknown>> = {};

/**
 * Secrets Managerからシークレットを取得する
 */
async function getSecret(secretName: string): Promise<Record<string, unknown>> {
  if (secretsCache[secretName]) {
    return secretsCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new CancelSubscriptionError(
      'SECRET_NOT_FOUND',
      `Secret ${secretName} is empty`
    );
  }

  const secret = JSON.parse(response.SecretString);
  secretsCache[secretName] = secret;

  return secret;
}

/**
 * Lambda handler
 */
export const handler = async (
  input: CancelSubscriptionInput
): Promise<CancelSubscriptionOutput> => {
  console.log('Internal cancelSubscription input:', JSON.stringify(input, null, 2));

  try {
    // 入力バリデーション
    if (!input.platform || !input.platformSubscriptionId || input.atPeriodEnd === undefined) {
      throw new CancelSubscriptionError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          platform: !!input.platform,
          platformSubscriptionId: !!input.platformSubscriptionId,
          atPeriodEnd: input.atPeriodEnd !== undefined,
        }
      );
    }

    if (!input.tenantId) {
      throw new CancelSubscriptionError(
        'INVALID_INPUT',
        'tenantIdは必須です'
      );
    }

    // プラットフォームごとにキャンセル処理を実行
    let result: CancelSubscriptionOutput;

    switch (input.platform) {
      case 'stripe':
        result = await cancelStripeSubscription(
          input.platformSubscriptionId,
          !input.atPeriodEnd, // atPeriodEnd: false = immediate cancel
          input.tenantId
        );
        break;

      case 'apple':
        // Appleの場合、サーバー側からのキャンセルはできない
        // ユーザーがApp Storeの設定から解約する必要がある
        throw new CancelSubscriptionError(
          'APPLE_CANCEL_NOT_SUPPORTED',
          'Apple subscriptions cannot be canceled server-side. Users must cancel through App Store settings.'
        );

      case 'google':
        if (!input.packageName || !input.purchaseToken) {
          throw new CancelSubscriptionError(
            'INVALID_INPUT',
            'packageName and purchaseToken are required for Google subscriptions'
          );
        }
        result = await cancelGoogleSubscription(
          input.platformSubscriptionId,
          input.packageName,
          input.purchaseToken,
          input.tenantId
        );
        break;

      default:
        throw new CancelSubscriptionError(
          'UNSUPPORTED_PLATFORM',
          `Unsupported platform type: ${input.platform}`
        );
    }

    console.log('Cancel subscription result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error in internal cancelSubscription:', error);

    if (error instanceof CancelSubscriptionError) {
      throw error;
    }

    throw new CancelSubscriptionError(
      'CANCEL_FAILED',
      error instanceof Error ? error.message : 'Unknown error',
      error
    );
  }
};

/**
 * Stripeのサブスクリプションをキャンセルする
 */
async function cancelStripeSubscription(
  subscriptionId: string,
  cancelImmediately: boolean,
  tenantId: string
): Promise<CancelSubscriptionOutput> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const stripe = new Stripe(secret.apiKey as string, {
    apiVersion: '2025-10-29.clover',
  });

  if (cancelImmediately) {
    // 即時キャンセル
    const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);

    return {
      success: true,
      canceledAt: new Date(canceledSubscription.canceled_at! * 1000).toISOString(),
      serviceEndDate: new Date(canceledSubscription.canceled_at! * 1000).toISOString(),
    };
  } else {
    // 期限終了時にキャンセル（有効期限まで利用可能）
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Stripe API Clover系では、current_period_endはSubscriptionItemレベルに移行
    const subscriptionItem = updatedSubscription.items.data[0];

    return {
      success: true,
      canceledAt: new Date().toISOString(),
      serviceEndDate: new Date(subscriptionItem.current_period_end * 1000).toISOString(),
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
): Promise<CancelSubscriptionOutput> {
  const secretName = `${tenantId}/billing/google`;
  const secret = await getSecret(secretName);

  // Google認証クライアントを作成
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(secret.serviceAccountKey as string),
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
