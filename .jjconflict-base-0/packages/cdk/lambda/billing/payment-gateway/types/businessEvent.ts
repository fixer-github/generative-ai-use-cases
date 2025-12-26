/**
 * ビジネスイベントタイプ（統括責務が処理する4つのイベント）
 */
export type BusinessEventType =
  | 'payment.succeeded' // 支払い更新成功
  | 'payment.failed' // 支払い失敗
  | 'subscription.canceled' // サブスクリプションキャンセル
  | 'subscription.updated' // サブスクリプション更新（プラン変更など）
  | 'subscription.plan_change_completed' // プラン変更Checkout完了
  | 'payment.refunded' // 返金
  | 'payment_method.updated' // 支払い方法更新
  | 'invoice.created' // 請求書作成
  | 'invoice.finalized' // 請求書確定
  | 'subscription.parental_activated'; // ペアレンタルコントロールによるサブスクリプション有効化

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

  /** 請求期間開始日時（Unixタイムスタンプ、秒） */
  periodStart?: number;

  /** 請求期間終了日時（Unixタイムスタンプ、秒） */
  periodEnd?: number;

  /** 支払い金額（payment.succeeded、payment.refunded時に含まれる） */
  amount?: number;

  /** 通貨コード（payment.succeeded、payment.refunded時に含まれる、ISO 4217形式） */
  currency?: string;

  /** プラットフォーム固有の決済ID（参照用） */
  platformPaymentId?: string;

  /** エラーメッセージ（payment.failed時に含まれる） */
  errorMessage?: string;

  /** 新しい支払い方法ID（payment_method.updated時に含まれる） */
  newPaymentMethodId?: string;

  /** プラットフォーム固有のサブスクリプションID（payment_method.updated時に含まれる） */
  platformSubscriptionId?: string;

  /** 新しいプランID（subscription.updated時に含まれる、プラン変更の場合） */
  newPlanId?: string;

  /** 以前のプランID（subscription.updated時に含まれる、プラン変更の場合） */
  previousPlanId?: string;

  /** Checkout Session ID（subscription.parental_activated時に含まれる） */
  sessionId?: string;

  /** 子供のメールアドレス（subscription.parental_activated時に含まれる） */
  childEmail?: string;

  /** ペアレンタルコントロールフラグ（subscription.parental_activated時にtrue） */
  isParentalControl?: boolean;

  /** プラットフォーム固有の生イベントデータ（詳細調査用） */
  eventData: Record<string, any>;
}
