/**
 * ビジネスイベントタイプ（統括責務が処理する4つのイベント）
 */
export type BusinessEventType =
  | 'payment.succeeded' // 支払い更新成功
  | 'payment.failed' // 支払い失敗
  | 'subscription.canceled' // サブスクリプションキャンセル
  | 'payment.refunded'; // 返金

/**
 * イベント詳細情報
 */
export interface EventDetail {
  /** プラットフォーム種別 */
  platform: 'stripe' | 'apple' | 'google';

  /** テナントID */
  tenantId: string;

  /** プラットフォーム固有のイベントID */
  eventId: string;

  /** プラットフォーム固有の元のイベントタイプ（参照用） */
  originalEventType: string;

  /** サブスクリプションID（必須） */
  subscriptionId: string;

  /** ユーザーID（必須） */
  userId: string;

  /** プランID（取得可能な場合） */
  planId?: string;

  /** サブスクリプション有効期限（取得可能な場合、ISO 8601形式） */
  expirationDate?: string;

  /** 支払い金額（payment.succeeded、payment.refunded時に含まれる） */
  amount?: number;

  /** 通貨コード（payment.succeeded、payment.refunded時に含まれる、ISO 4217形式） */
  currency?: string;

  /** プラットフォーム固有の決済ID（参照用） */
  platformPaymentId?: string;

  /** エラーメッセージ（payment.failed時に含まれる） */
  errorMessage?: string;

  /** プラットフォーム固有の生イベントデータ（詳細調査用） */
  eventData: Record<string, any>;
}
