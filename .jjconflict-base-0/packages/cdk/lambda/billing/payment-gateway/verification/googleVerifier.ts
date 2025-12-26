import { google } from 'googleapis';
import { VerificationResult } from '../repositories/types';

export class GoogleVerifier {
  private packageName: string;
  private serviceAccountKey: any;

  constructor(packageName: string, serviceAccountKey: any) {
    this.packageName = packageName;
    this.serviceAccountKey = serviceAccountKey;
  }

  /**
   * Google Play Developer APIを使用してサブスクリプションを検証する
   * @param subscriptionId プロダクトID（サブスクリプションID）
   * @param purchaseToken 購入トークン
   * @returns 検証結果
   */
  async verify(
    subscriptionId: string,
    purchaseToken: string
  ): Promise<VerificationResult> {
    try {
      // Google認証クライアントを作成
      const auth = new google.auth.GoogleAuth({
        credentials: this.serviceAccountKey,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });

      const androidPublisher = google.androidpublisher({
        version: 'v3',
        auth: auth,
      });

      // サブスクリプション情報を取得
      const response = await androidPublisher.purchases.subscriptions.get({
        packageName: this.packageName,
        subscriptionId: subscriptionId,
        token: purchaseToken,
      });

      const subscription = response.data;

      if (!subscription) {
        return {
          success: false,
          data: undefined,
        };
      }

      // サブスクリプションの状態をチェック
      // paymentState: 0 = 支払い保留, 1 = 支払い済み, 2 = 無料トライアル, 3 = 猶予期間
      const isPaymentReceived = [1, 2, 3].includes(
        subscription.paymentState ?? 0
      );

      const expiryTimeMillis = subscription.expiryTimeMillis
        ? parseInt(subscription.expiryTimeMillis, 10)
        : 0;
      const isActive = expiryTimeMillis > Date.now();

      return {
        success: isPaymentReceived && isActive,
        data: {
          subscriptionId: subscriptionId,
          orderId: subscription.orderId,
          purchaseToken: purchaseToken,
          startTime: subscription.startTimeMillis
            ? new Date(
                parseInt(subscription.startTimeMillis, 10)
              ).toISOString()
            : undefined,
          expiresAt: new Date(expiryTimeMillis).toISOString(),
          autoRenewing: subscription.autoRenewing,
          paymentState: subscription.paymentState,
          cancelReason: subscription.cancelReason,
          userCancellationTime: subscription.userCancellationTimeMillis
            ? new Date(
                parseInt(subscription.userCancellationTimeMillis, 10)
              ).toISOString()
            : undefined,
        },
      };
    } catch (error) {
      console.error('Google verification failed:', error);

      // エラーの種類に応じて処理を分岐
      if (error instanceof Error) {
        if (error.message.includes('Invalid Value')) {
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
   * ワンタイム購入を検証する
   * @param productId プロダクトID
   * @param purchaseToken 購入トークン
   * @returns 検証結果
   */
  async verifyProduct(
    productId: string,
    purchaseToken: string
  ): Promise<VerificationResult> {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: this.serviceAccountKey,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });

      const androidPublisher = google.androidpublisher({
        version: 'v3',
        auth: auth,
      });

      const response = await androidPublisher.purchases.products.get({
        packageName: this.packageName,
        productId: productId,
        token: purchaseToken,
      });

      const product = response.data;

      if (!product) {
        return {
          success: false,
          data: undefined,
        };
      }

      // 消費状態をチェック
      // consumptionState: 0 = 未消費, 1 = 消費済み
      // purchaseState: 0 = 購入済み, 1 = キャンセル済み, 2 = 保留中
      const isPurchased = product.purchaseState === 0;

      return {
        success: isPurchased,
        data: {
          productId: productId,
          orderId: product.orderId,
          purchaseToken: purchaseToken,
          purchaseTime: product.purchaseTimeMillis
            ? new Date(
                parseInt(product.purchaseTimeMillis, 10)
              ).toISOString()
            : undefined,
          purchaseState: product.purchaseState,
          consumptionState: product.consumptionState,
          acknowledgementState: product.acknowledgementState,
        },
      };
    } catch (error) {
      console.error('Google product verification failed:', error);
      throw error;
    }
  }
}
