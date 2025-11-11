import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType, VerificationResult } from '../repositories/types';
import { StripeVerifier } from './stripeVerifier';
import { AppleVerifier } from './appleVerifier';
import { GoogleVerifier } from './googleVerifier';
import { ReceiptCacheRepository } from '../repositories/receiptCacheRepository';
import { detectPlatformFromReceipt } from '../utils/platformDetector';

/**
 * Lambda関数ハンドラーのイベント型
 */
interface VerifyReceiptEvent {
  platformType?: PlatformType;
  receipt: string;
  tenantId: string;
  // Google固有のパラメータ
  subscriptionId?: string; // Google Play Billingのプロダクト（サブスクリプション）ID
}

/**
 * Lambda関数ハンドラーのレスポンス型
 */
interface VerifyReceiptResponse {
  success: boolean;
  data?: any;
  cached?: boolean;
  error?: string;
}

/**
 * シークレットのキャッシュ（コールドスタート対策）
 */
const secretsCache: Record<string, any> = {};

/**
 * Secrets Managerからシークレットを取得する
 */
async function getSecret(secretName: string): Promise<any> {
  if (secretsCache[secretName]) {
    return secretsCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  secretsCache[secretName] = secret;

  return secret;
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: VerifyReceiptEvent
): Promise<VerifyReceiptResponse> {
  console.log('Verify receipt request:', {
    platformType: event.platformType,
    tenantId: event.tenantId,
    receiptLength: event.receipt?.length,
  });

  try {
    const { receipt, tenantId } = event;

    if (!receipt) {
      return {
        success: false,
        error: 'Receipt is required',
      };
    }

    // プラットフォーム種別を判定（指定がない場合は自動判定）
    const platformType =
      event.platformType || detectPlatformFromReceipt(receipt);

    if (!platformType) {
      return {
        success: false,
        error: 'Could not detect platform type from receipt',
      };
    }

    console.log('Detected platform:', platformType);

    // レシート検証キャッシュリポジトリを初期化
    const cacheTableName =
      process.env.RECEIPT_CACHE_TABLE_NAME ||
      `${tenantId}-payment-gateway-receipt-cache`;
    const cacheRepository = new ReceiptCacheRepository(cacheTableName);

    // レシート検証を実行
    const result = await verifyReceiptWithFallback(
      platformType,
      receipt,
      tenantId,
      cacheRepository,
      event.subscriptionId
    );

    return result;
  } catch (error) {
    console.error('Receipt verification error:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * レシート検証をキャッシュフォールバック付きで実行する
 */
async function verifyReceiptWithFallback(
  platformType: PlatformType,
  receipt: string,
  tenantId: string,
  cacheRepository: ReceiptCacheRepository,
  subscriptionId?: string
): Promise<VerifyReceiptResponse> {
  try {
    // 通常のレシート検証を試行
    const result = await verifyReceiptByPlatform(
      platformType,
      receipt,
      tenantId,
      subscriptionId
    );

    // 検証成功時はキャッシュに保存
    if (result.success) {
      await cacheRepository.save(receipt, result);
      console.log('Verification result cached');
    }

    return result;
  } catch (error) {
    console.error('Receipt verification failed, checking cache:', error);

    // 検証失敗時、キャッシュを確認
    const cachedResult = await cacheRepository.findByReceiptHash(receipt);

    if (cachedResult) {
      console.log('Using cached verification result');
      return {
        ...cachedResult,
        cached: true,
      };
    }

    // キャッシュミス、2秒待機して再検証を試行
    console.log('Cache miss, retrying after 2 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const retryResult = await verifyReceiptByPlatform(
        platformType,
        receipt,
        tenantId,
        subscriptionId
      );

      // 再検証成功時はキャッシュに保存
      if (retryResult.success) {
        await cacheRepository.save(receipt, retryResult);
      }

      return retryResult;
    } catch (retryError) {
      console.error('Retry also failed:', retryError);

      // 再検証も失敗した場合は、検証失敗結果を返す
      return {
        success: false,
        error:
          retryError instanceof Error
            ? retryError.message
            : 'Verification failed after retry',
      };
    }
  }
}

/**
 * プラットフォームごとのレシート検証を実行する
 */
async function verifyReceiptByPlatform(
  platformType: PlatformType,
  receipt: string,
  tenantId: string,
  subscriptionId?: string
): Promise<VerificationResult> {
  switch (platformType) {
    case 'stripe':
      return verifyStripeReceipt(receipt, tenantId);

    case 'apple':
      return verifyAppleReceipt(receipt, tenantId);

    case 'google':
      if (!subscriptionId) {
        throw new Error('subscriptionId is required for Google verification');
      }
      return verifyGoogleReceipt(receipt, subscriptionId, tenantId);

    default:
      throw new Error(`Unsupported platform type: ${platformType}`);
  }
}

/**
 * Stripeのレシート検証
 */
async function verifyStripeReceipt(
  subscriptionId: string,
  tenantId: string
): Promise<VerificationResult> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const verifier = new StripeVerifier(secret.apiKey);

  // サブスクリプションIDまたはCheckout Session IDで検証
  if (subscriptionId.startsWith('cs_')) {
    return verifier.verifyCheckoutSession(subscriptionId);
  } else {
    return verifier.verify(subscriptionId);
  }
}

/**
 * Appleのレシート検証
 */
async function verifyAppleReceipt(
  receipt: string,
  tenantId: string
): Promise<VerificationResult> {
  const secretName = `${tenantId}/billing/apple`;
  const secret = await getSecret(secretName);

  const verifier = new AppleVerifier(secret.bundleId, secret.isProduction);

  // レシートタイプを判定（JWSかBase64エンコードされたレシートか）
  if (receipt.split('.').length === 3) {
    // JWSフォーマット - トランザクションIDとして扱う
    // 実際にはJWSをデコードしてトランザクションIDを抽出する必要がある
    return verifier.verify(receipt);
  } else {
    // レガシーレシート検証
    return verifier.verifyReceipt(receipt);
  }
}

/**
 * Googleのレシート検証
 */
async function verifyGoogleReceipt(
  purchaseToken: string,
  subscriptionId: string,
  tenantId: string
): Promise<VerificationResult> {
  const secretName = `${tenantId}/billing/google`;
  const secret = await getSecret(secretName);

  const verifier = new GoogleVerifier(
    secret.packageName,
    JSON.parse(secret.serviceAccountKey)
  );

  return verifier.verify(subscriptionId, purchaseToken);
}
