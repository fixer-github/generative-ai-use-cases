/**
 * Webhook event type definitions
 *
 * This file defines types for webhook event processing including:
 * - Platform types (Stripe, Apple, Google)
 * - Webhook event types for each platform
 * - Event payload structures
 */

import { PlatformType } from './flowTypes';

/**
 * Webhookイベントタイプ
 *
 * 各決済プラットフォームから送信されるイベントタイプを定義します。
 */
export type WebhookEventType =
  // Stripe events
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.canceled'
  | 'subscription.updated' // サブスクリプション更新（プラン変更など）
  | 'refund.created'
  | 'payment_method.updated'
  | 'subscription.parental_activated' // ペアレンタルコントロールによるサブスクリプション有効化
  // Apple events (App Store Server Notifications)
  | 'RENEWAL'
  | 'DID_FAIL_TO_RENEW'
  | 'DID_CHANGE_RENEWAL_STATUS'
  | 'REFUND'
  // Google Play events (Real-time Developer Notifications)
  | 'SUBSCRIPTION_RENEWED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_REFUNDED';

/**
 * Webhookイベントペイロード
 *
 * EventBridgeから渡されるWebhookイベントの共通構造です。
 * Payment Gateway責務で署名検証と重複チェック済みのイベントが配信されます。
 */
export interface WebhookEventPayload {
  /** イベントID（一意識別子） */
  eventId: string;

  /** テナントID */
  tenantId: string;

  /** 決済プラットフォーム */
  platform: PlatformType;

  /** イベントタイプ */
  eventType: WebhookEventType;

  /** イベントデータ（プラットフォーム固有の情報） */
  eventData: Record<string, unknown>;
}

/**
 * Webhookイベント処理フローの入力
 *
 * WebhookEventPayloadをそのまま使用します。
 */
export interface WebhookEventFlowInput extends WebhookEventPayload {
  // WebhookEventPayloadをそのまま継承
}

/**
 * Stripe Webhookイベントの詳細データ
 *
 * Stripeから送信される主要なイベントのデータ構造例です。
 */
export interface StripeEventData {
  /** サブスクリプションID */
  subscriptionId?: string;

  /** 金額 */
  amount?: number;

  /** 通貨コード */
  currency?: string;

  /** 期間終了日時（Unixタイムスタンプ、秒） */
  periodEnd?: number;

  /** カスタマーID */
  customerId?: string;

  /** 請求書ID */
  invoiceId?: string;

  /** SetupIntent ID（payment_method.updated時） */
  setupIntentId?: string;

  /** プラットフォームサブスクリプションID（payment_method.updated時） */
  platformSubscriptionId?: string;

  /** 抽出された詳細情報 */
  _extracted?: {
    setupIntentId?: string;
    platformSubscriptionId?: string;
    customerId?: string;
    // ペアレンタルコントロール用フィールド
    sessionId?: string;
    userId?: string;
    planId?: string;
    childEmail?: string;
    parentEmail?: string;
    // サブスクリプション更新（プラン変更）用フィールド
    subscriptionId?: string;
    currentPriceId?: string;
    previousPriceId?: string;
    isPlanChange?: boolean;
    isParentalControlPlanChange?: boolean;
    status?: string;
    // Checkoutベースのプラン変更用フィールド
    newPlanId?: string;
    previousPlanId?: string;
    previousSubscriptionId?: string;
    newPlatformSubscriptionId?: string;
    internalSubscriptionId?: string;
    isUpgrade?: string;
  };

  /** その他のStripe固有データ */
  [key: string]: unknown;
}

/**
 * Apple Webhookイベントの詳細データ
 *
 * App Store Server Notificationsから送信される主要なイベントのデータ構造例です。
 */
export interface AppleEventData {
  /** トランザクションID */
  transactionId?: string;

  /** オリジナルトランザクションID */
  originalTransactionId?: string;

  /** プロダクトID */
  productId?: string;

  /** 購入日時（ミリ秒） */
  purchaseDate?: number;

  /** 有効期限（ミリ秒） */
  expiresDate?: number;

  /** その他のApple固有データ */
  [key: string]: unknown;
}

/**
 * Google Play Webhookイベントの詳細データ
 *
 * Real-time Developer Notificationsから送信される主要なイベントのデータ構造例です。
 */
export interface GoogleEventData {
  /** サブスクリプションID */
  subscriptionId?: string;

  /** 購入トークン */
  purchaseToken?: string;

  /** プロダクトID */
  productId?: string;

  /** 有効期限（ミリ秒） */
  expiryTimeMillis?: number;

  /** その他のGoogle固有データ */
  [key: string]: unknown;
}
