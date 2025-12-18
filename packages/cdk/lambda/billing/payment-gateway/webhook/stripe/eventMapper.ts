import Stripe from 'stripe';
import { BusinessEventType } from '../../types/businessEvent';

/**
 * マッピング関数の型（動的マッピング用）
 */
type EventMapper = (event: Stripe.Event) => BusinessEventType | null;

/**
 * Checkout Session型ガード
 */
function isCheckoutSession(
  obj: Stripe.Event.Data.Object
): obj is Stripe.Checkout.Session {
  return 'object' in obj && obj.object === 'checkout.session';
}

/**
 * Stripeイベントタイプ → ビジネスイベントタイプのマッピング
 * 静的マッピングと動的マッピング（関数）の両方をサポート
 */
const STRIPE_TO_BUSINESS_EVENT_MAP: Record<
  string,
  BusinessEventType | EventMapper
> = {
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.paid': 'payment.succeeded', // 補助的なマッピング
  'invoice.payment_failed': 'payment.failed',
  'invoice.created': 'invoice.created',
  'invoice.finalized': 'invoice.finalized',
  'customer.subscription.deleted': 'subscription.canceled',
  'charge.refunded': 'payment.refunded',
  // checkout.session.completedは動的にマッピング（setup modeのみ処理）
  'checkout.session.completed': (event: Stripe.Event): BusinessEventType | null => {
    const eventObject = event.data.object;
    if (!isCheckoutSession(eventObject)) {
      return null;
    }
    // setup modeかつpurposeがupdate_payment_methodの場合のみ処理
    if (
      eventObject.mode === 'setup' &&
      eventObject.metadata?.purpose === 'update_payment_method'
    ) {
      return 'payment_method.updated';
    }
    // subscriptionモードのcheckoutはinvoiceイベントで処理されるためスキップ
    return null;
  },
};

/**
 * Stripeイベントタイプをビジネスイベントタイプにマッピング
 * @param stripeEventType Stripeイベントタイプ
 * @param stripeEvent Stripeイベントオブジェクト（動的マッピング用、オプション）
 * @returns ビジネスイベントタイプ、またはnull（マッピング対象外）
 */
export function mapStripeEventToBusinessEvent(
  stripeEventType: string,
  stripeEvent?: Stripe.Event
): BusinessEventType | null {
  const mapping = STRIPE_TO_BUSINESS_EVENT_MAP[stripeEventType];

  if (!mapping) {
    return null;
  }

  // 関数の場合は動的にマッピング
  if (typeof mapping === 'function') {
    if (!stripeEvent) {
      // イベントオブジェクトがない場合はマッピング不可
      return null;
    }
    return mapping(stripeEvent);
  }

  // 静的マッピングの場合はそのまま返す
  return mapping;
}

/**
 * マッピング対象のイベントかどうかを判定
 * @param stripeEventType Stripeイベントタイプ
 * @returns マッピング対象の場合true
 */
export function isBusinessEventMappable(stripeEventType: string): boolean {
  return stripeEventType in STRIPE_TO_BUSINESS_EVENT_MAP;
}
