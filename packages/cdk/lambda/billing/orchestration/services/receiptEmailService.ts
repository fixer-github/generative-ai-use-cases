/**
 * Receipt Email Service
 *
 * 支払い完了後の領収書メールを送信するサービス。
 * Stripe決済完了後に自動的に領収書を送信します。
 * ペアレンタルコントロールの場合は保護者にのみ送信されます。
 */

import Stripe from 'stripe';
import {
  sendEmail,
  createEmailHtml,
  escapeHtml,
  formatPrice,
  formatDate,
  COLORS,
  getServiceName,
} from './emailService';
import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';

/**
 * Cloverバージョン対応: インボイスからサブスクリプションIDを抽出するヘルパー関数
 *
 * Stripe API バージョン 2025-10-29.clover では invoice.subscription が
 * 直接存在しない場合があるため、複数のパスからサブスクリプションIDを取得する
 */
function extractSubscriptionIdFromInvoice(invoice: Record<string, any>): string | null {
  // 方法1: 従来の invoice.subscription（文字列またはオブジェクト）
  if (invoice.subscription) {
    if (typeof invoice.subscription === 'string') {
      return invoice.subscription;
    }
    if (invoice.subscription?.id) {
      return invoice.subscription.id;
    }
  }

  // 方法2: Cloverバージョン - parent.subscription_details.subscription
  if (invoice.parent?.subscription_details?.subscription) {
    return invoice.parent.subscription_details.subscription;
  }

  // 方法3: Cloverバージョン - lines.data[].parent.subscription_item_details.subscription
  const lineItemSubscription =
    invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
  if (lineItemSubscription) {
    return lineItemSubscription;
  }

  // 方法4: 従来のフォールバック - lines.data[].subscription
  if (invoice.lines?.data?.[0]?.subscription) {
    return invoice.lines.data[0].subscription;
  }

  return null;
}

/**
 * 領収書データ
 */
export interface ReceiptData {
  /** 支払い金額 */
  amount: number;
  /** 通貨 */
  currency: string;
  /** 支払い日 */
  paymentDate: Date;
  /** プラン名 */
  planName: string;
  /** 請求書番号 */
  invoiceNumber: string;
  /** 次回請求日 */
  nextBillingDate: Date;
  /** 請求期間開始日 */
  billingPeriodStart: Date;
  /** 請求期間終了日 */
  billingPeriodEnd: Date;
  /** 支払い方法（カード末尾4桁） */
  paymentMethodLast4: string;
  /** 送信先メールアドレス */
  recipientEmail: string;
  /** ペアレンタルコントロールかどうか */
  isParentalControl?: boolean;
  /** 子供のメールアドレス（ペアレンタルコントロールの場合） */
  childEmail?: string;
}

/**
 * 領収書メール本文を生成
 */
function createReceiptBodyContent(data: ReceiptData): string {
  const serviceName = getServiceName();
  const safePlanName = escapeHtml(data.planName);

  const parentalControlNote =
    data.isParentalControl && data.childEmail
      ? `<p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 14px;">
        お子様（${escapeHtml(data.childEmail)}）のサブスクリプションに関する領収書です。
      </p>`
      : '';

  return `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">お支払い完了のお知らせ</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${serviceName}をご利用いただきありがとうございます。<br>
      お支払いが正常に完了しました。
    </p>
    ${parentalControlNote}
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">お支払い金額</span><br>
            <span style="font-size: 24px; font-weight: bold; color: ${COLORS.accent};">${formatPrice(data.amount, data.currency)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">お支払い日</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${formatDate(data.paymentDate)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">プラン名</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${safePlanName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">請求書番号</span><br>
            <span style="font-size: 16px; color: ${COLORS.primary};">${escapeHtml(data.invoiceNumber)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">請求期間</span><br>
            <span style="font-size: 16px; color: ${COLORS.primary};">${formatDate(data.billingPeriodStart)} 〜 ${formatDate(data.billingPeriodEnd)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">次回請求日</span><br>
            <span style="font-size: 16px; color: ${COLORS.primary};">${formatDate(data.nextBillingDate)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 0;">
            <span style="font-size: 14px; color: #666;">お支払い方法</span><br>
            <span style="font-size: 16px; color: ${COLORS.primary};">カード末尾 ${escapeHtml(data.paymentMethodLast4)}</span>
          </td>
        </tr>
      </table>
    </div>
    <p style="margin: 24px 0 0 0; color: #666; font-size: 13px; line-height: 1.5;">
      ご不明な点がございましたら、アカウント設定からお問い合わせください。
    </p>
  `;
}

/**
 * 領収書メールを送信
 */
export async function sendPaymentReceipt(data: ReceiptData): Promise<void> {
  const serviceName = getServiceName();
  const subject = `【${serviceName}】お支払い完了のお知らせ`;
  const bodyContent = createReceiptBodyContent(data);
  const footerNote = 'この領収書は自動送信されています。';

  const htmlContent = createEmailHtml(
    'お支払い完了のお知らせ',
    bodyContent,
    footerNote
  );

  await sendEmail(data.recipientEmail, subject, htmlContent);
}

/**
 * Stripeインボイスから領収書データを構築
 */
export async function buildReceiptDataFromInvoice(
  stripe: Stripe,
  invoiceId: string,
  tenantId: string,
  planId?: string
): Promise<
  Omit<ReceiptData, 'recipientEmail' | 'isParentalControl' | 'childEmail'>
> {
  // インボイスを取得（payments.data.payment.payment_intent と subscription を展開）
  const invoiceResponse = await stripe.invoices.retrieve(invoiceId, {
    expand: ['payments.data.payment.payment_intent', 'subscription'],
  });
  const invoice = invoiceResponse as Stripe.Invoice;

  // 基本データ抽出
  const amount = invoice.amount_paid ?? 0;
  const currency = invoice.currency || 'jpy';
  const paymentDate = new Date(invoice.created * 1000);
  const invoiceNumber =
    invoice.number || `INV-${invoice.id.slice(-8).toUpperCase()}`;

  console.log('Building receipt data from invoice', {
    invoiceId,
    amount,
    currency,
    invoiceNumber,
    amountPaid: invoice.amount_paid,
    total: invoice.total,
    inputPlanId: planId,
  });

  // 請求期間
  const lineItem = invoice.lines?.data?.[0];
  if (!lineItem?.period?.start || !lineItem?.period?.end) {
    throw new Error(
      `Unable to determine billing period from invoice ${invoice.id}. ` +
        `Invoice must contain line item with period information.`
    );
  }
  const billingPeriodStart = new Date(lineItem.period.start * 1000);
  const billingPeriodEnd = new Date(lineItem.period.end * 1000);
  const nextBillingDate = billingPeriodEnd;

  // プラン名取得
  let planName = 'サブスクリプションプラン';

  const invoiceAny = invoice as unknown as Record<string, any>;
  let effectivePlanId = planId;

  // subscription が展開されている場合は直接メタデータを取得
  // Cloverバージョン対応: invoice.subscription が存在しない場合も考慮
  const subscriptionObj = invoiceAny.subscription;
  if (
    !effectivePlanId &&
    subscriptionObj &&
    typeof subscriptionObj === 'object'
  ) {
    // 展開されたサブスクリプションから直接メタデータを取得
    const metadata = subscriptionObj.metadata;
    effectivePlanId = metadata?.planId || metadata?.newPlanId || null;
  }

  // Cloverバージョン対応: parent.subscription_details からメタデータを取得
  if (!effectivePlanId && invoiceAny.parent?.subscription_details?.metadata) {
    const metadata = invoiceAny.parent.subscription_details.metadata;
    effectivePlanId = metadata?.planId || metadata?.newPlanId || null;
  }

  // フォールバック: サブスクリプションを別途取得してメタデータを確認
  if (!effectivePlanId) {
    effectivePlanId = await extractPlanIdFromInvoiceWithCloverSupport(stripe, invoiceAny) ?? undefined;
  }

  if (effectivePlanId) {
    try {
      const plan = await invokeDataAccessFunctionByTenantId<Plan | null>(
        tenantId,
        'plan',
        'findById',
        { id: effectivePlanId }
      );
      console.log('Plan lookup result', {
        effectivePlanId,
        planFound: !!plan,
        displayName: plan?.display_name,
        internalName: plan?.internal_name,
      });
      if (plan?.display_name) {
        planName = plan.display_name;
      }
    } catch (error) {
      console.warn('Failed to fetch plan name', {
        planId: effectivePlanId,
        error,
      });
    }
  } else {
    console.warn('No plan ID available for receipt, using default plan name');
  }

  // 支払い方法（カード末尾4桁）
  // getCurrentSubscription.ts と同じロジックを使用
  let paymentMethodLast4 = '****';

  // ヘルパー関数: IDまたはオブジェクトからIDを抽出
  const extractId = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'id' in value) {
      return (value as { id: string }).id;
    }
    return null;
  };

  // ヘルパー関数: 顧客の支払い方法を取得してlast4を返す
  const getPaymentMethodLast4 = async (
    customerId: string,
    pmId: string
  ): Promise<string | null> => {
    try {
      const pm = await stripe.customers.retrievePaymentMethod(customerId, pmId);
      if (pm.card?.last4) {
        return pm.card.last4;
      }
    } catch (error) {
      console.warn('Failed to retrieve customer payment method', {
        customerId,
        pmId,
        error,
      });
    }
    return null;
  };

  // 顧客IDを取得
  const customerId = extractId(invoiceAny.customer);

  console.log('Extracting payment method from invoice', {
    invoiceId,
    customerId,
    hasPayments: !!invoiceAny.payments?.data?.length,
    paymentsCount: invoiceAny.payments?.data?.length ?? 0,
    hasDefaultPaymentMethod: !!invoiceAny.default_payment_method,
    hasSubscription: !!invoiceAny.subscription,
  });

  if (customerId) {
    // 方法1: subscription.default_payment_method から取得
    const subObj = invoiceAny.subscription;
    if (paymentMethodLast4 === '****' && subObj && typeof subObj === 'object') {
      const pmId = extractId(subObj.default_payment_method);
      if (pmId) {
        const last4 = await getPaymentMethodLast4(customerId, pmId);
        if (last4) {
          paymentMethodLast4 = `****${last4}`;
          console.log('Got last4 from subscription.default_payment_method', {
            last4,
          });
        }
      }
    }

    // 方法2: invoice.default_payment_method から取得
    if (paymentMethodLast4 === '****' && invoiceAny.default_payment_method) {
      const pmId = extractId(invoiceAny.default_payment_method);
      if (pmId) {
        const last4 = await getPaymentMethodLast4(customerId, pmId);
        if (last4) {
          paymentMethodLast4 = `****${last4}`;
          console.log('Got last4 from invoice.default_payment_method', {
            last4,
          });
        }
      }
    }

    // 方法3: invoice.payments.data[0].payment.payment_intent.payment_method から取得
    if (
      paymentMethodLast4 === '****' &&
      invoiceAny.payments?.data?.length > 0
    ) {
      const firstPayment = invoiceAny.payments.data[0];
      if (firstPayment?.payment?.payment_intent) {
        const paymentIntentId = extractId(firstPayment.payment.payment_intent);
        if (paymentIntentId) {
          try {
            const paymentIntent =
              await stripe.paymentIntents.retrieve(paymentIntentId);
            const pmId = extractId(paymentIntent.payment_method);
            if (pmId) {
              const last4 = await getPaymentMethodLast4(customerId, pmId);
              if (last4) {
                paymentMethodLast4 = `****${last4}`;
                console.log(
                  'Got last4 from invoice.payments.payment.payment_intent.payment_method',
                  { last4 }
                );
              }
            }
          } catch (error) {
            console.warn('Failed to retrieve payment intent', {
              paymentIntentId,
              error,
            });
          }
        }
      }
    }

    // 方法4: 顧客の支払い方法一覧から最新のカードを取得（最終フォールバック）
    if (paymentMethodLast4 === '****') {
      try {
        console.log('Trying to list customer payment methods as fallback');
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customerId,
          type: 'card',
          limit: 1,
        });
        if (
          paymentMethods.data.length > 0 &&
          paymentMethods.data[0].card?.last4
        ) {
          paymentMethodLast4 = `****${paymentMethods.data[0].card.last4}`;
          console.log('Got last4 from customer payment method list', {
            last4: paymentMethods.data[0].card.last4,
          });
        }
      } catch (error) {
        console.warn('Failed to list customer payment methods', {
          customerId,
          error,
        });
      }
    }
  }

  if (paymentMethodLast4 === '****') {
    console.warn('Could not extract payment method last4 from any source', {
      invoiceId,
      customerId,
    });
  }

  return {
    amount,
    currency,
    paymentDate,
    planName,
    invoiceNumber,
    nextBillingDate,
    billingPeriodStart,
    billingPeriodEnd,
    paymentMethodLast4,
  };
}

/**
 * インボイスからプランIDを抽出（Cloverバージョン対応）
 *
 * サブスクリプションのmetadataから以下の優先順位でplanIdを取得:
 * 1. planId - 新規購入時に設定されるプランID
 * 2. newPlanId - プラン変更時に設定される新しいプランID
 *
 * Cloverバージョンでは invoice.subscription が存在しない場合があるため、
 * extractSubscriptionIdFromInvoice を使用してサブスクリプションIDを取得する
 */
async function extractPlanIdFromInvoiceWithCloverSupport(
  stripe: Stripe,
  invoice: Record<string, any>
): Promise<string | null> {
  // Cloverバージョン対応: 複数のパスからサブスクリプションIDを取得
  const subscriptionId = extractSubscriptionIdFromInvoice(invoice);

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // planId（新規購入）またはnewPlanId（プラン変更）のいずれかを返す
      if (subscription.metadata?.planId) {
        return subscription.metadata.planId;
      }
      if (subscription.metadata?.newPlanId) {
        return subscription.metadata.newPlanId;
      }
    } catch (error) {
      console.warn('Failed to fetch subscription for planId extraction', {
        subscriptionId,
        error,
      });
    }
  }

  return null;
}

/**
 * 領収書の送信先を決定
 * ペアレンタルコントロールの場合は保護者のメールアドレスを返す
 * 通常のサブスクリプションの場合はStripe Customerのメールを使用
 */
export async function getReceiptRecipient(
  stripe: Stripe,
  platformSubscriptionId: string,
  fallbackEmail?: string
): Promise<{
  email: string;
  isParentalControl: boolean;
  childEmail?: string;
}> {
  try {
    const subscription = await stripe.subscriptions.retrieve(
      platformSubscriptionId
    );

    const isParentalControl =
      subscription.metadata?.isParentalControl === 'true';
    const childEmail = subscription.metadata?.childEmail;

    // カスタマーIDを取得
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;

    // Stripeカスタマーからメールアドレスを取得
    const customer = await stripe.customers.retrieve(customerId);
    const customerEmail =
      typeof customer !== 'string' && !customer.deleted && customer.email
        ? customer.email
        : null;

    if (isParentalControl) {
      // ペアレンタルコントロール: Stripeカスタマーのメールアドレス（保護者）
      if (customerEmail) {
        return {
          email: customerEmail,
          isParentalControl: true,
          childEmail,
        };
      }
    }

    // 通常のサブスクリプション: Stripeカスタマーメールまたはフォールバックを使用
    const email = customerEmail || fallbackEmail;
    if (email) {
      return {
        email,
        isParentalControl: false,
      };
    }

    throw new Error('Unable to determine receipt recipient email');
  } catch (error) {
    console.error('Failed to get receipt recipient', {
      platformSubscriptionId,
      error,
    });

    // フォールバックメールがあれば使用
    if (fallbackEmail) {
      return {
        email: fallbackEmail,
        isParentalControl: false,
      };
    }

    throw error;
  }
}

/**
 * ユーザーのメールアドレスを取得
 * Note: orchestration flowではDynamoDB直接アクセスが難しいため、
 * Stripe Customerからメールを取得するか、nullを返してフォールバック処理に任せる
 */
export async function getUserEmail(
  _tenantId: string,
  _userId: string
): Promise<string | null> {
  // Note: UserStripeMappingテーブルへのアクセスはAPI Gateway経由でのみ可能
  // orchestration flowでは直接アクセスできないため、nullを返してStripe Customerメールを使用
  console.log(
    'getUserEmail: Returning null, will use Stripe Customer email as fallback'
  );
  return null;
}
