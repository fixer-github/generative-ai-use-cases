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
  /** プラン変更かどうか */
  isPlanChange?: boolean;
  /** 旧プラン名（プラン変更時） */
  previousPlanName?: string;
  /** 旧プラン未使用分のクレジット額（負の値、プラン変更時） */
  unusedCredit?: number;
  /** 新プラン日割り料金（正の値、プラン変更時） */
  newPlanProration?: number;
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
        ${
          data.isPlanChange &&
          (data.unusedCredit !== undefined ||
            data.newPlanProration !== undefined)
            ? `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">プラン変更明細</span><br>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 8px;">
              ${
                data.previousPlanName && data.unusedCredit !== undefined
                  ? `
              <tr>
                <td style="font-size: 14px; color: ${COLORS.text}; padding: 4px 0;">
                  旧プラン（${escapeHtml(data.previousPlanName)}）未使用分
                </td>
                <td style="font-size: 14px; color: #28a745; text-align: right; padding: 4px 0;">
                  -${formatPrice(Math.abs(data.unusedCredit), data.currency)}
                </td>
              </tr>
              `
                  : ''
              }
              ${
                data.newPlanProration !== undefined
                  ? `
              <tr>
                <td style="font-size: 14px; color: ${COLORS.text}; padding: 4px 0;">
                  新プラン（${escapeHtml(data.planName)}）日割り
                </td>
                <td style="font-size: 14px; color: ${COLORS.text}; text-align: right; padding: 4px 0;">
                  +${formatPrice(data.newPlanProration, data.currency)}
                </td>
              </tr>
              `
                  : ''
              }
              ${
                data.unusedCredit !== undefined &&
                data.newPlanProration !== undefined
                  ? `
              <tr>
                <td colspan="2" style="border-top: 1px solid ${COLORS.lightGray}; padding-top: 8px;"></td>
              </tr>
              <tr>
                <td style="font-size: 14px; font-weight: bold; color: ${COLORS.text}; padding: 4px 0;">
                  差額
                </td>
                <td style="font-size: 14px; font-weight: bold; color: ${COLORS.accent}; text-align: right; padding: 4px 0;">
                  ${formatPrice(data.newPlanProration + data.unusedCredit, data.currency)}
                </td>
              </tr>
              `
                  : ''
              }
            </table>
          </td>
        </tr>
        `
            : ''
        }
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
  planId?: string,
  previousPlanId?: string
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

  // サブスクリプション展開の状態を確認
  const subscriptionField = (invoice as unknown as Record<string, unknown>)
    .subscription;
  const isSubscriptionExpanded =
    subscriptionField && typeof subscriptionField === 'object';
  const subscriptionId =
    typeof subscriptionField === 'string'
      ? subscriptionField
      : (subscriptionField as { id: string } | null)?.id;

  console.log('Building receipt data from invoice', {
    invoiceId,
    amount,
    currency,
    invoiceNumber,
    amountPaid: invoice.amount_paid,
    total: invoice.total,
    inputPlanId: planId,
    billingReason: invoice.billing_reason,
    isSubscriptionExpanded,
    subscriptionId,
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
  let effectivePreviousPlanId = previousPlanId;

  // サブスクリプションからメタデータを取得
  // Cloverバージョン対応: invoice.subscription が存在しない場合も考慮
  const effectiveSubscriptionId = subscriptionId || extractSubscriptionIdFromInvoice(invoiceAny);

  if (effectiveSubscriptionId) {
    try {
      // 展開されている場合は直接取得を試みる
      let metadata: Record<string, string> | undefined;

      if (isSubscriptionExpanded) {
        metadata = (subscriptionField as { metadata?: Record<string, string> })
          .metadata;
        console.log('Using expanded subscription metadata', {
          hasMetadata: !!metadata,
          metadataKeys: metadata ? Object.keys(metadata) : [],
        });
      }

      // Cloverバージョン対応: parent.subscription_details からメタデータを取得
      if (!metadata && invoiceAny.parent?.subscription_details?.metadata) {
        metadata = invoiceAny.parent.subscription_details.metadata;
        console.log('Using Clover parent.subscription_details metadata', {
          hasMetadata: !!metadata,
          metadataKeys: metadata ? Object.keys(metadata) : [],
        });
      }

      // 展開されていない場合、またはメタデータが空の場合はAPIで取得
      if (!metadata || Object.keys(metadata).length === 0) {
        console.log('Fetching subscription metadata via API', {
          subscriptionId: effectiveSubscriptionId,
        });
        const subscription =
          await stripe.subscriptions.retrieve(effectiveSubscriptionId);
        metadata = subscription.metadata;
        console.log('Fetched subscription metadata', {
          subscriptionId: effectiveSubscriptionId,
          hasMetadata: !!metadata,
          metadataKeys: metadata ? Object.keys(metadata) : [],
          planId: metadata?.planId,
          newPlanId: metadata?.newPlanId,
          previousPlanId: metadata?.previousPlanId,
        });
      }

      // planId の取得（プラン変更の場合はnewPlanIdを優先）
      if (!effectivePlanId) {
        effectivePlanId = metadata?.newPlanId || metadata?.planId || undefined;
        console.log('Extracted planId from subscription metadata', {
          hasPlanId: !!metadata?.planId,
          hasNewPlanId: !!metadata?.newPlanId,
          effectivePlanId,
        });
      }

      // previousPlanId の取得
      if (!effectivePreviousPlanId && metadata?.previousPlanId) {
        effectivePreviousPlanId = metadata.previousPlanId;
        console.log('Extracted previousPlanId from subscription metadata', {
          previousPlanId: effectivePreviousPlanId,
        });
      }
    } catch (error) {
      console.warn('Failed to fetch subscription metadata', {
        subscriptionId: effectiveSubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // フォールバック: まだ planId が取得できなかった場合
  if (!effectivePlanId || !effectivePreviousPlanId) {
    const extractedIds = await extractPlanIdsFromInvoice(
      stripe,
      invoice,
      effectiveSubscriptionId ?? undefined
    );
    if (!effectivePlanId && extractedIds.planId) {
      effectivePlanId = extractedIds.planId;
    }
    if (!effectivePreviousPlanId && extractedIds.previousPlanId) {
      effectivePreviousPlanId = extractedIds.previousPlanId;
    }
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

  // プロレーション情報の抽出（プラン変更時）
  const invoiceLines = invoice.lines?.data || [];
  const prorationLines = invoiceLines.filter((line) => {
    const desc = line.description?.toLowerCase() || '';
    // プロレーション行を判定（Stripeのdescriptionに含まれるキーワードで判定）
    // 英語・日本語の両方のキーワードをサポート
    const lineAny = line as unknown as Record<string, unknown>;
    return (
      desc.includes('unused') ||
      desc.includes('remaining') ||
      desc.includes('proration') ||
      desc.includes('未使用') ||
      desc.includes('残り') ||
      desc.includes('日割り') ||
      lineAny.proration === true // Stripeのproration フラグも確認
    );
  });

  // プラン変更かどうかを判定
  const isPlanChange = prorationLines.length > 0 || !!effectivePreviousPlanId;

  // 未使用クレジット（負の金額）と追加料金（正の金額）を分離
  let unusedCredit: number | undefined;
  let newPlanProration: number | undefined;

  if (isPlanChange && prorationLines.length > 0) {
    const creditAmount = prorationLines
      .filter((line) => line.amount < 0)
      .reduce((sum, line) => sum + line.amount, 0);
    unusedCredit = creditAmount !== 0 ? creditAmount : undefined;

    const prorationAmount = prorationLines
      .filter((line) => line.amount > 0)
      .reduce((sum, line) => sum + line.amount, 0);
    newPlanProration = prorationAmount !== 0 ? prorationAmount : undefined;

    console.log('Proration info extracted from invoice', {
      invoiceId,
      prorationLinesCount: prorationLines.length,
      unusedCredit,
      newPlanProration,
    });
  }

  // 旧プラン名とプラン価格の取得
  let previousPlanName: string | undefined;
  let previousPlanPriceId: string | undefined;
  let currentPlanPriceId: string | undefined;

  if (effectivePreviousPlanId) {
    try {
      const previousPlan =
        await invokeDataAccessFunctionByTenantId<Plan | null>(
          tenantId,
          'plan',
          'findById',
          { id: effectivePreviousPlanId }
        );
      previousPlanName = previousPlan?.display_name;
      previousPlanPriceId = previousPlan?.platform_product_id;
      console.log('Previous plan lookup result', {
        previousPlanId: effectivePreviousPlanId,
        previousPlanName,
        previousPlanPriceId,
      });
    } catch (error) {
      console.warn('Failed to fetch previous plan name', {
        previousPlanId: effectivePreviousPlanId,
        error,
      });
    }

    // 新プランのStripe Price IDも取得
    if (effectivePlanId) {
      try {
        const currentPlan =
          await invokeDataAccessFunctionByTenantId<Plan | null>(
            tenantId,
            'plan',
            'findById',
            { id: effectivePlanId }
          );
        currentPlanPriceId = currentPlan?.platform_product_id;
        console.log('Current plan lookup result for price comparison', {
          effectivePlanId,
          currentPlanPriceId,
        });
      } catch (error) {
        console.warn('Failed to fetch current plan for price', {
          effectivePlanId,
          error,
        });
      }
    }

    // プロレーション行がない場合、Stripe Priceから価格を取得して日割り差額を計算
    if (
      prorationLines.length === 0 &&
      previousPlanPriceId &&
      currentPlanPriceId
    ) {
      try {
        const [previousPrice, currentPrice] = await Promise.all([
          stripe.prices.retrieve(previousPlanPriceId),
          stripe.prices.retrieve(currentPlanPriceId),
        ]);

        const previousAmount = previousPrice.unit_amount || 0;
        const currentAmount = currentPrice.unit_amount || 0;

        // サブスクリプションの請求期間を取得して日割り計算
        // 新しいサブスクリプションの請求期間から残り日数を計算
        const periodStart = billingPeriodStart;
        const periodEnd = billingPeriodEnd;
        const totalDays = Math.ceil(
          (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
        );
        const daysRemaining = Math.ceil(
          (periodEnd.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // 日割り計算（残り日数 / 期間の総日数）
        const prorationRatio =
          totalDays > 0 ? Math.min(daysRemaining / totalDays, 1) : 1;

        // 旧プランの未使用分（日割りクレジット）
        const proratedPreviousAmount = Math.round(
          previousAmount * prorationRatio
        );
        // 新プランの日割り料金
        const proratedCurrentAmount = Math.round(
          currentAmount * prorationRatio
        );

        // 差額を計算（新プラン日割り料金を表示、旧プラン日割り料金をクレジットとして表示）
        newPlanProration = proratedCurrentAmount;
        // 旧プランの未使用分は負の値として表示
        unusedCredit = -proratedPreviousAmount;

        console.log('Prorated price calculation from Stripe', {
          previousPlanPriceId,
          currentPlanPriceId,
          previousAmount,
          currentAmount,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          paymentDate: paymentDate.toISOString(),
          totalDays,
          daysRemaining,
          prorationRatio,
          proratedPreviousAmount,
          proratedCurrentAmount,
          calculatedNewPlanProration: newPlanProration,
          calculatedUnusedCredit: unusedCredit,
        });
      } catch (error) {
        console.warn('Failed to fetch Stripe prices for comparison', {
          previousPlanPriceId,
          currentPlanPriceId,
          error,
        });
      }
    }
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
    isPlanChange,
    previousPlanName,
    unusedCredit,
    newPlanProration,
  };
}

/**
 * インボイスからプランIDを抽出（Cloverバージョン対応）
 *
 * サブスクリプションのmetadataから以下の情報を取得:
 * - planId: 新規購入時に設定されるプランID、またはnewPlanId（プラン変更時）
 * - previousPlanId: プラン変更前のプランID
 *
 * Cloverバージョンでは invoice.subscription が存在しない場合があるため、
 * extractSubscriptionIdFromInvoice を使用してサブスクリプションIDを取得する
 */
async function extractPlanIdsFromInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  subscriptionIdOverride?: string
): Promise<{ planId: string | null; previousPlanId: string | null }> {
  // サブスクリプションIDを取得（Cloverバージョン対応）
  const invoiceAny = invoice as unknown as Record<string, unknown>;
  const subscriptionField = invoiceAny.subscription;
  const subscriptionId =
    subscriptionIdOverride ||
    (typeof subscriptionField === 'string'
      ? subscriptionField
      : (subscriptionField as { id: string } | null)?.id) ||
    extractSubscriptionIdFromInvoice(invoiceAny);

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      console.log('Extracting planIds from subscription metadata', {
        subscriptionId,
        hasPlanId: !!subscription.metadata?.planId,
        hasNewPlanId: !!subscription.metadata?.newPlanId,
        hasPreviousPlanId: !!subscription.metadata?.previousPlanId,
      });

      // planId（新規購入）またはnewPlanId（プラン変更）
      const planId =
        subscription.metadata?.planId ||
        subscription.metadata?.newPlanId ||
        null;
      const previousPlanId = subscription.metadata?.previousPlanId || null;

      return { planId, previousPlanId };
    } catch (error) {
      console.warn('Failed to fetch subscription for planId extraction', {
        subscriptionId,
        error,
      });
    }
  }

  return { planId: null, previousPlanId: null };
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
