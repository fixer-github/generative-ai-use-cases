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
 * Subscription型ガード
 */
function isSubscription(
  obj: Stripe.Event.Data.Object
): obj is Stripe.Subscription {
  return 'object' in obj && obj.object === 'subscription';
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
  'customer.subscription.deleted': 'subscription.canceled',
  'charge.refunded': 'payment.refunded',
  // customer.subscription.updatedは動的にマッピング（プラン変更時のみ処理）
  'customer.subscription.updated': (
    event: Stripe.Event
  ): BusinessEventType | null => {
    // previous_attributes をチェック
    const previousAttributes = event.data.previous_attributes as
      | Record<string, unknown>
      | undefined;
    if (!previousAttributes) {
      return null;
    }
    // items, plan, default_price のいずれかが変更されている場合はプラン変更として処理
    // - items: 通常のプラン変更（API経由）
    // - plan: Billing Portal経由でのプラン変更
    // - default_price: 価格変更を伴うプラン変更
    if (
      'items' in previousAttributes ||
      'plan' in previousAttributes ||
      'default_price' in previousAttributes
    ) {
      return 'subscription.updated';
    }
    // プラン関連の変更がない場合はスキップ（他の属性変更は無視）
    return null;
  },
  // checkout.session.completedは動的にマッピング
  'checkout.session.completed': (
    event: Stripe.Event
  ): BusinessEventType | null => {
    const eventObject = event.data.object;
    if (!isCheckoutSession(eventObject)) {
      return null;
    }
    // setup modeかつpurposeがupdate_payment_methodの場合
    if (
      eventObject.mode === 'setup' &&
      eventObject.metadata?.purpose === 'update_payment_method'
    ) {
      return 'payment_method.updated';
    }
    // subscription modeかつプラン変更の場合
    if (
      eventObject.mode === 'subscription' &&
      eventObject.metadata?.type === 'plan_change'
    ) {
      return 'subscription.plan_change_completed';
    }
    // subscription modeかつペアレンタルコントロールの場合
    if (
      eventObject.mode === 'subscription' &&
      eventObject.metadata?.isParentalControl === 'true'
    ) {
      return 'subscription.parental_activated';
    }
    // その他のsubscriptionモードのcheckoutはinvoiceイベントで処理されるためスキップ
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
