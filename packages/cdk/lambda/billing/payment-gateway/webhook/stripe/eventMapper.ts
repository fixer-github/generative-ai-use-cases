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
  'customer.subscription.updated': (event: Stripe.Event): BusinessEventType | null => {
    const previousAttributes = event.data.previous_attributes as Record<string, unknown> | undefined;

    console.log('Processing customer.subscription.updated event', {
      eventId: event.id,
      previousAttributesKeys: previousAttributes ? Object.keys(previousAttributes) : [],
      hasItems: previousAttributes ? 'items' in previousAttributes : false,
    });

    // Method 1: previous_attributes に items が含まれている場合（標準的なプラン変更）
    if (previousAttributes && 'items' in previousAttributes) {
      console.log('Plan change detected via previous_attributes.items (standard flow)');
      return 'subscription.updated';
    }

    // Method 2: ペアレンタルコントロールによるプラン変更検出
    // Customer Portalの subscription_update_confirm では previous_attributes.items が
    // 含まれない場合があるため、メタデータで検出
    if (isSubscription(event.data.object)) {
      const subscription = event.data.object;
      const metadata = subscription.metadata;

      const currentPriceId =
        typeof subscription.items.data[0]?.price === 'string'
          ? subscription.items.data[0]?.price
          : subscription.items.data[0]?.price?.id;

      console.log('Checking parental control metadata', {
        subscriptionId: subscription.id,
        pendingPlanChange: metadata?.pendingPlanChange,
        originalPriceId: metadata?.originalPriceId,
        targetPriceId: metadata?.targetPriceId,
        currentPriceId,
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });

      // pendingPlanChange フラグがあり、現在のプライスがtargetPriceIdと一致する場合
      if (metadata?.pendingPlanChange === 'true' && metadata?.targetPriceId) {
        if (currentPriceId === metadata.targetPriceId) {
          console.log('Plan change detected via metadata (parental control flow)', {
            subscriptionId: subscription.id,
            originalPriceId: metadata.originalPriceId,
            targetPriceId: metadata.targetPriceId,
            currentPriceId,
          });
          return 'subscription.updated';
        } else {
          console.log('Price mismatch - currentPriceId does not match targetPriceId', {
            currentPriceId,
            targetPriceId: metadata.targetPriceId,
          });
        }
      }
    }

    // items の変更がなく、メタデータによる検出もできない場合はスキップ
    console.log('No plan change detected, skipping event');
    return null;
  },
  // checkout.session.completedは動的にマッピング
  'checkout.session.completed': (event: Stripe.Event): BusinessEventType | null => {
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
