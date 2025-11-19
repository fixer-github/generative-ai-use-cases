import Stripe from 'stripe';
import { EventDetail } from '../../types/businessEvent';

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

    case 'charge.refunded':
      return extractFromChargeRefunded(stripeEvent, tenantId);

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
