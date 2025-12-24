import Stripe from 'stripe';
import { EventDetail } from '../../types/businessEvent';

/**
 * Checkout Session型ガード
 */
function isCheckoutSession(
  obj: Stripe.Event.Data.Object
): obj is Stripe.Checkout.Session {
  return 'object' in obj && obj.object === 'checkout.session';
}

/**
 * Stripeイベントから必須情報を抽出
 * @param stripeEvent Stripeイベントオブジェクト
 * @param tenantId テナントID
 * @returns 正規化されたイベント詳細情報
 * @throws Error 必須フィールドが取得できない場合
 */
export async function extractEventDetail(
  stripeEvent: Stripe.Event,
  tenantId: string
): Promise<Partial<EventDetail>> {
  const eventType = stripeEvent.type;

  // イベントタイプに応じて抽出処理を分岐
  switch (eventType) {
    case 'invoice.payment_succeeded':
    case 'invoice.paid':
      return extractFromInvoicePaymentSucceeded(stripeEvent, tenantId);

    case 'invoice.payment_failed':
      return extractFromInvoicePaymentFailed(stripeEvent, tenantId);

    case 'customer.subscription.deleted':
      return extractFromSubscriptionDeleted(stripeEvent, tenantId);

    case 'customer.subscription.updated':
      return extractFromSubscriptionUpdated(stripeEvent, tenantId);

    case 'charge.refunded':
      return extractFromChargeRefunded(stripeEvent, tenantId);

    case 'checkout.session.completed':
      return extractFromCheckoutSessionCompleted(stripeEvent, tenantId);

    default:
      throw new Error(`Unsupported event type: ${eventType}`);
  }
}

/**
 * invoice.payment_succeeded / invoice.paid からの情報抽出
 */
function extractFromInvoicePaymentSucceeded(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const invoice = stripeEvent.data.object as any;

  // subscriptionIdの抽出（Cloverバージョン対応）
  const subscriptionId =
    (typeof invoice.subscription === 'string' ? invoice.subscription : '') ||
    invoice.parent?.subscription_details?.subscription ||
    invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ||
    invoice.lines?.data?.[0]?.subscription ||
    '';

  if (!subscriptionId) {
    throw new Error(
      'subscriptionId is required but not found in invoice.payment_succeeded event'
    );
  }

  // userIdの抽出（metadata優先、なければcustomerから）
  const userId =
    invoice.parent?.subscription_details?.metadata?.userId ||
    invoice.subscription_details?.metadata?.userId ||
    invoice.metadata?.userId ||
    '';

  if (!userId) {
    console.warn(
      `userId not found in invoice metadata. subscriptionId: ${subscriptionId}`
    );
  }

  // planId (priceId) の抽出（Cloverバージョンではlines.data[].pricing.price_details.price）
  const planId =
    invoice.lines?.data?.[0]?.pricing?.price_details?.price ||
    invoice.lines?.data?.[0]?.price?.id ||
    '';

  // expirationDateの抽出（Invoice Lineのperiod.endを使用）
  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  const expirationDate = periodEnd
    ? new Date(periodEnd * 1000).toISOString()
    : undefined;

  // 支払い金額と通貨
  const amount = invoice.amount_paid || invoice.total || 0;
  const currency = invoice.currency || 'jpy';

  // platformPaymentIdの抽出（Cloverでは payments 配列から取得）
  const platformPaymentId =
    invoice.payments?.data?.find((p: any) => p.status === 'succeeded')
      ?.payment_intent ||
    invoice.payment_intent ||
    invoice.id;

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId: subscriptionId as string,
    userId,
    planId,
    expirationDate,
    amount,
    currency,
    platformPaymentId: platformPaymentId as string,
    eventData: stripeEvent,
  };
}

/**
 * invoice.payment_failed からの情報抽出
 */
function extractFromInvoicePaymentFailed(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const invoice = stripeEvent.data.object as any;

  // subscriptionIdの抽出（Cloverバージョン対応）
  const subscriptionId =
    (typeof invoice.subscription === 'string' ? invoice.subscription : '') ||
    invoice.parent?.subscription_details?.subscription ||
    invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ||
    invoice.lines?.data?.[0]?.subscription ||
    '';

  if (!subscriptionId) {
    throw new Error(
      'subscriptionId is required but not found in invoice.payment_failed event'
    );
  }

  const userId =
    invoice.parent?.subscription_details?.metadata?.userId ||
    invoice.subscription_details?.metadata?.userId ||
    invoice.metadata?.userId ||
    '';

  if (!userId) {
    console.warn(
      `userId not found in invoice metadata. subscriptionId: ${subscriptionId}`
    );
  }

  const planId =
    invoice.lines?.data?.[0]?.pricing?.price_details?.price ||
    invoice.lines?.data?.[0]?.price?.id ||
    '';

  // エラーメッセージ（詳細は後でPaymentIntentから取得可能）
  const errorMessage = 'Payment failed. Please update your payment method.';

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId: subscriptionId as string,
    userId,
    planId,
    errorMessage,
    eventData: stripeEvent,
  };
}

/**
 * customer.subscription.deleted からの情報抽出
 */
function extractFromSubscriptionDeleted(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const subscription = stripeEvent.data.object as Stripe.Subscription;

  const subscriptionId = subscription.id;

  if (!subscriptionId) {
    throw new Error(
      'subscriptionId is required but not found in customer.subscription.deleted event'
    );
  }

  const userId = subscription.metadata?.userId || '';

  if (!userId) {
    console.warn(
      `userId not found in subscription metadata. subscriptionId: ${subscriptionId}`
    );
  }

  const planId =
    (typeof subscription.items.data[0]?.price === 'string'
      ? subscription.items.data[0]?.price
      : subscription.items.data[0]?.price?.id) || '';

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId,
    userId,
    planId,
    eventData: stripeEvent,
  };
}

/**
 * customer.subscription.updated からの情報抽出
 * Customer Portalやsubscriptions.update APIによるプラン変更時に発火
 */
function extractFromSubscriptionUpdated(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const subscription = stripeEvent.data.object as Stripe.Subscription;
  // previous_attributes には変更前の値が含まれる
  const previousAttributes = (stripeEvent.data as any).previous_attributes ?? {};

  const subscriptionId = subscription.id;

  if (!subscriptionId) {
    throw new Error(
      'subscriptionId is required but not found in customer.subscription.updated event'
    );
  }

  const userId = subscription.metadata?.userId || '';

  if (!userId) {
    console.warn(
      `userId not found in subscription metadata. subscriptionId: ${subscriptionId}`
    );
  }

  // 現在のprice ID（新しいプラン）
  const currentPriceId =
    (typeof subscription.items.data[0]?.price === 'string'
      ? subscription.items.data[0]?.price
      : subscription.items.data[0]?.price?.id) || '';

  // 変更前のprice ID（previous_attributesから取得）
  // items配列の変更がある場合、previous_attributes.items に変更前の値がある
  let previousPriceId = '';
  if (previousAttributes.items?.data?.[0]?.price) {
    const prevPrice = previousAttributes.items.data[0].price;
    previousPriceId = typeof prevPrice === 'string' ? prevPrice : prevPrice?.id || '';
  }

  // プラン変更があったかどうかを判定
  const isPlanChange = previousPriceId && previousPriceId !== currentPriceId;

  console.log('Subscription updated event details', {
    subscriptionId,
    userId,
    currentPriceId,
    previousPriceId,
    isPlanChange,
    previousAttributesKeys: Object.keys(previousAttributes),
  });

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId,
    userId,
    planId: currentPriceId,
    newPlanId: isPlanChange ? currentPriceId : undefined,
    previousPlanId: isPlanChange ? previousPriceId : undefined,
    platformSubscriptionId: subscriptionId,
    eventData: {
      ...stripeEvent,
      _extracted: {
        subscriptionId,
        userId,
        currentPriceId,
        previousPriceId,
        isPlanChange,
        status: subscription.status,
      },
    },
  };
}

/**
 * charge.refunded からの情報抽出
 */
function extractFromChargeRefunded(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const charge = stripeEvent.data.object as any;

  // chargeからinvoiceを取得し、subscriptionIdを逆引き
  const invoiceId = charge.invoice as string | undefined;

  // subscriptionIdはinvoiceから取得する必要があるが、
  // ここではまだAPIコールしないため、invoiceIdのみ記録
  // 統括責務側でinvoiceIdからsubscriptionIdを取得することを想定
  const subscriptionId = ''; // invoiceからの逆引きが必要

  const userId = charge.metadata?.userId || '';

  const amount = charge.amount_refunded || 0;
  const currency = charge.currency || 'jpy';
  const platformPaymentId = charge.id;

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId, // 空の場合、統括責務側で補完
    userId,
    amount,
    currency,
    platformPaymentId,
    eventData: stripeEvent,
  };
}

/**
 * checkout.session.completed からの情報抽出
 *
 * setup mode: 支払い方法更新のためのCheckout Session完了イベントを処理
 * subscription mode (parental control): ペアレンタルコントロールによるサブスクリプション有効化を処理
 */
function extractFromCheckoutSessionCompleted(
  stripeEvent: Stripe.Event,
  tenantId: string
): Partial<EventDetail> {
  const eventObject = stripeEvent.data.object;
  if (!isCheckoutSession(eventObject)) {
    throw new Error('Event object is not a Checkout Session');
  }

  const metadata = eventObject.metadata ?? {};

  // subscription mode かつ ペアレンタルコントロールの場合
  if (
    eventObject.mode === 'subscription' &&
    metadata.isParentalControl === 'true'
  ) {
    return extractFromParentalControlCheckout(stripeEvent, eventObject, tenantId, metadata);
  }

  // setup modeの場合（既存の処理）
  if (eventObject.mode === 'setup') {
    return extractFromSetupModeCheckout(stripeEvent, eventObject, tenantId, metadata);
  }

  throw new Error(`Unsupported checkout session mode: ${eventObject.mode}`);
}

/**
 * ペアレンタルコントロールCheckout Session（subscription mode）からの情報抽出
 */
function extractFromParentalControlCheckout(
  stripeEvent: Stripe.Event,
  session: Stripe.Checkout.Session,
  tenantId: string,
  metadata: Record<string, string>
): Partial<EventDetail> {
  const userId = metadata.userId ?? '';
  const planId = metadata.planId ?? '';
  const childEmail = metadata.childEmail ?? '';

  // StripeのサブスクリプションIDを取得
  const platformSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? '';

  if (!userId) {
    console.warn('userId not found in parental control session metadata');
  }

  if (!planId) {
    console.warn('planId not found in parental control session metadata');
  }

  if (!platformSubscriptionId) {
    console.warn('subscription not found in parental control session');
  }

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId: '', // まだ内部サブスクリプションIDは作成されていない
    userId,
    planId,
    platformSubscriptionId,
    sessionId: session.id,
    childEmail,
    isParentalControl: true,
    eventData: {
      ...stripeEvent,
      _extracted: {
        sessionId: session.id,
        platformSubscriptionId,
        userId,
        planId,
        childEmail,
        parentEmail: metadata.parentEmail ?? '',
      },
    },
  };
}

/**
 * Setup mode Checkout Sessionからの情報抽出（支払い方法更新）
 */
function extractFromSetupModeCheckout(
  stripeEvent: Stripe.Event,
  session: Stripe.Checkout.Session,
  tenantId: string,
  metadata: Record<string, string>
): Partial<EventDetail> {
  // SetupIntentのIDを取得
  const setupIntentId =
    typeof session.setup_intent === 'string'
      ? session.setup_intent
      : session.setup_intent?.id;

  if (!setupIntentId) {
    throw new Error('SetupIntent ID not found in checkout session');
  }

  const subscriptionId = metadata.subscription_id ?? '';
  const platformSubscriptionId = metadata.platform_subscription_id ?? '';
  const userId = metadata.user_id ?? '';

  // 顧客IDを取得
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

  if (!subscriptionId) {
    console.warn('subscription_id not found in session metadata');
  }

  if (!userId) {
    console.warn('user_id not found in session metadata');
  }

  return {
    platform: 'stripe',
    tenantId,
    eventId: stripeEvent.id,
    originalEventType: stripeEvent.type,
    subscriptionId,
    userId,
    platformPaymentId: setupIntentId, // SetupIntent IDを格納
    platformSubscriptionId,
    eventData: {
      ...stripeEvent,
      _extracted: {
        setupIntentId,
        platformSubscriptionId,
        customerId,
      },
    },
  };
}
