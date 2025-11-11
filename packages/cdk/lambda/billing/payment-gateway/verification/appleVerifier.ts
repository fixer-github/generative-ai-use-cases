import { VerificationResult } from '../repositories/types';

export class AppleVerifier {
  private bundleId: string;
  private isProduction: boolean;

  constructor(bundleId: string, isProduction: boolean = false) {
    this.bundleId = bundleId;
    this.isProduction = isProduction;
  }

  /**
   * Apple App Store Server APIを使用してトランザクションを検証する
   * @param transactionId トランザクションID
   * @returns 検証結果
   */
  async verify(transactionId: string): Promise<VerificationResult> {
    try {
      const baseUrl = this.isProduction
        ? 'https://api.storekit.itunes.apple.com'
        : 'https://api.storekit-sandbox.itunes.apple.com';

      const url = `${baseUrl}/inApps/v1/transactions/${transactionId}`;

      // TODO: JWT認証トークンを生成する
      // Appleの認証には、App Store Connect APIキー（p8ファイル）を使用してJWTを生成する必要があります
      // 参考: https://developer.apple.com/documentation/appstoreserverapi/generating_tokens_for_api_requests

      const jwtToken = await this.generateJWT();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Apple API request failed: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      // JWSをデコードして検証
      const transaction = this.decodeJWS(data.signedTransaction);

      // トランザクションの状態をチェック
      const now = Date.now();
      const expiresDate = transaction.expiresDate
        ? parseInt(transaction.expiresDate, 10)
        : 0;
      const isActive = expiresDate > now;

      return {
        success: isActive,
        data: {
          transactionId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          productId: transaction.productId,
          purchaseDate: new Date(
            parseInt(transaction.purchaseDate, 10)
          ).toISOString(),
          expiresAt: expiresDate
            ? new Date(expiresDate).toISOString()
            : undefined,
          bundleId: transaction.bundleId,
          subscriptionGroupIdentifier: transaction.subscriptionGroupIdentifier,
        },
      };
    } catch (error) {
      console.error('Apple verification failed:', error);
      throw error;
    }
  }

  /**
   * JWTトークンを生成する
   * TODO: 実際の実装では、App Store Connect APIキー（p8ファイル）を使用してJWTを生成
   */
  private async generateJWT(): Promise<string> {
    // 仮実装: 実際にはSecrets Managerからp8キーを取得し、JWTを生成する
    throw new Error(
      'JWT generation not implemented. Need to use App Store Connect API Key.'
    );
  }

  /**
   * JWSをデコードする
   * @param jws JWS文字列
   * @returns デコードされたペイロード
   */
  private decodeJWS(jws: string): any {
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWS format');
    }

    const payload = Buffer.from(parts[1], 'base64').toString();
    return JSON.parse(payload);
  }

  /**
   * レシートをApp Store Server APIを使用して検証する（レガシー）
   * 注: App Store Server APIの使用を推奨
   */
  async verifyReceipt(receiptData: string): Promise<VerificationResult> {
    try {
      const url = this.isProduction
        ? 'https://buy.itunes.apple.com/verifyReceipt'
        : 'https://sandbox.itunes.apple.com/verifyReceipt';

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'receipt-data': receiptData,
          password: process.env.APPLE_SHARED_SECRET,
          'exclude-old-transactions': true,
        }),
      });

      const data = await response.json();

      // ステータスコードをチェック
      // 0: 成功
      // 21007: サンドボックスのレシートを本番環境に送信した（自動的にサンドボックスにリトライ）
      if (data.status === 21007 && this.isProduction) {
        // サンドボックス環境で再検証
        const sandboxVerifier = new AppleVerifier(this.bundleId, false);
        return sandboxVerifier.verifyReceipt(receiptData);
      }

      if (data.status !== 0) {
        return {
          success: false,
          data: {
            status: data.status,
            error: `Apple receipt verification failed with status: ${data.status}`,
          },
        };
      }

      const latestReceiptInfo = data.latest_receipt_info?.[0];

      if (!latestReceiptInfo) {
        return {
          success: false,
          data: undefined,
        };
      }

      const expiresDate = parseInt(latestReceiptInfo.expires_date_ms, 10);
      const isActive = expiresDate > Date.now();

      return {
        success: isActive,
        data: {
          transactionId: latestReceiptInfo.transaction_id,
          originalTransactionId: latestReceiptInfo.original_transaction_id,
          productId: latestReceiptInfo.product_id,
          purchaseDate: new Date(
            parseInt(latestReceiptInfo.purchase_date_ms, 10)
          ).toISOString(),
          expiresAt: new Date(expiresDate).toISOString(),
          bundleId: data.receipt.bundle_id,
        },
      };
    } catch (error) {
      console.error('Apple receipt verification failed:', error);
      throw error;
    }
  }
}
