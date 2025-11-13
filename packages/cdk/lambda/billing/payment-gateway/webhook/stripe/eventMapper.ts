import { BusinessEventType } from '../../types/businessEvent';

/**
 * Stripeイベントタイプ → ビジネスイベントタイプのマッピング
 */
const STRIPE_TO_BUSINESS_EVENT_MAP: Record<string, BusinessEventType> = {
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.paid': 'payment.succeeded', // 補助的なマッピング
  'invoice.payment_failed': 'payment.failed',
  'customer.subscription.deleted': 'subscription.canceled',
  'charge.refunded': 'payment.refunded',
};

/**
 * Stripeイベントタイプをビジネスイベントタイプにマッピング
 * @param stripeEventType Stripeイベントタイプ
 * @returns ビジネスイベントタイプ、またはnull（マッピング対象外）
 */
export function mapStripeEventToBusinessEvent(
  stripeEventType: string
): BusinessEventType | null {
  return STRIPE_TO_BUSINESS_EVENT_MAP[stripeEventType] || null;
}

/**
 * マッピング対象のイベントかどうかを判定
 * @param stripeEventType Stripeイベントタイプ
 * @returns マッピング対象の場合true
 */
export function isBusinessEventMappable(stripeEventType: string): boolean {
  return stripeEventType in STRIPE_TO_BUSINESS_EVENT_MAP;
}
