import Stripe from 'stripe';
import { VerificationResult } from '../repositories/types';

export class StripeVerifier {
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });
  }

  /**
   * Stripeのサブスクリプションを検証する
   * @param subscriptionId サブスクリプションID
   * @returns 検証結果
   */
  async verify(subscriptionId: string): Promise<VerificationResult> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['latest_invoice', 'customer'],
        }
      );

      // サブスクリプションの状態をチェック
      const isActive = ['active', 'trialing'].includes(subscription.status);

      // Stripe API Clover系では、current_period_start/endはSubscriptionItemレベルに移行
      const subscriptionItem = subscription.items.data[0];

      return {
        success: isActive,
        data: {
          subscriptionId: subscription.id,
          customerId:
            typeof subscription.customer === 'string'
              ? subscription.customer
              : subscription.customer.id,
          status: subscription.status,
          currentPeriodStart: new Date(
            subscriptionItem.current_period_start * 1000
          ).toISOString(),
          currentPeriodEnd: new Date(
            subscriptionItem.current_period_end * 1000
          ).toISOString(),
          productId: subscriptionItem?.price?.id,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000).toISOString()
            : undefined,
        },
      };
    } catch (error) {
      console.error('Stripe verification failed:', error);

      // エラーの種類に応じて処理を分岐
      if (error instanceof Error) {
        if (error.message.includes('No such subscription')) {
          return {
            success: false,
            data: undefined,
          };
        }
      }

      // ネットワークエラーやAPIエラーの場合は例外をスロー（キャッシュフォールバックを試行）
      throw error;
    }
  }

  /**
   * Checkout Sessionを検証する
   * @param sessionId Checkout Session ID
   * @returns 検証結果
   */
  async verifyCheckoutSession(sessionId: string): Promise<VerificationResult> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer'],
      });

      const isComplete = session.status === 'complete';

      return {
        success: isComplete,
        data: {
          sessionId: session.id,
          subscriptionId:
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id,
          customerId:
            typeof session.customer === 'string'
              ? session.customer
              : session.customer?.id,
          status: session.status,
          amountTotal: session.amount_total,
          currency: session.currency,
          paymentStatus: session.payment_status,
        },
      };
    } catch (error) {
      console.error('Stripe checkout session verification failed:', error);
      throw error;
    }
  }
}
