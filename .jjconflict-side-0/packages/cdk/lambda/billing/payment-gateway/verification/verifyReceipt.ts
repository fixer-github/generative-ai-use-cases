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
 * リクエストの型（Lambda直接呼び出し形式）
 */
interface VerifyReceiptRequest {
  /** テナントID（必須） */
  tenantId: string;
  /** プラットフォームタイプ（stripe、apple、google、オプション） */
  platformType?: PlatformType;
  /** レシートデータ */
  receipt: string;
  /** サブスクリプションID（Google固有、オプション） */
  subscriptionId?: string;
}

/**
 * レスポンスの型
 */
interface VerifyReceiptResponse {
  /** レシートが有効かどうか */
  isValid: boolean;
  /** プラットフォーム側のサブスクリプションID */
  platformSubscriptionId?: string;
  /** プランID */
  planId?: string;
  /** 有効期限（ISO 8601形式） */
  expiresAt?: string;
  /** エラーメッセージ */
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
 * Lambda関数のメインハンドラー（Lambda直接呼び出し形式）
 *
 * このLambdaはオーケストレーション層から直接呼び出されます。
 * API Gateway経由ではないため、eventオブジェクト自体がリクエストボディです。
 */
export async function handler(
  event: VerifyReceiptRequest
): Promise<VerifyReceiptResponse> {
  console.log('Verify receipt request received');

  try {
    const { tenantId, receipt, platformType, subscriptionId } = event;

    // 1. 必須パラメータのバリデーション
    if (!tenantId) {
      console.error('Missing tenantId');
      return {
        isValid: false,
        error: 'tenantId is required',
      };
    }

    if (!receipt) {
      console.error('Missing receipt');
      return {
        isValid: false,
        error: 'Receipt is required',
      };
    }

    console.log('Verify receipt request:', {
      platformType,
      tenantId,
      receiptLength: receipt?.length,
    });

    // 2. プラットフォーム種別を判定（指定がない場合は自動判定）
    const detectedPlatformType =
      platformType || detectPlatformFromReceipt(receipt);

    if (!detectedPlatformType) {
      console.error('Could not detect platform type');
      return {
        isValid: false,
        error: 'Could not detect platform type from receipt',
      };
    }

    console.log('Detected platform:', detectedPlatformType);

    // 3. テーブル名を動的に構築
    const cacheTableName = `${tenantId}-payment-gateway-receipt-cache`;
    const cacheRepository = new ReceiptCacheRepository(cacheTableName);

    // 4. レシート検証を実行
    const result = await verifyReceiptWithFallback(
      detectedPlatformType,
      receipt,
      tenantId,
      cacheRepository,
      subscriptionId
    );

    // 5. VerificationResultをVerifyReceiptResponseに変換
    return convertToResponse(result);
  } catch (error) {
    console.error('Receipt verification error:', error);

    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * VerificationResultをVerifyReceiptResponseに変換する
 */
function convertToResponse(result: VerificationResult): VerifyReceiptResponse {
  if (!result.success) {
    return {
      isValid: false,
      error: result.data?.error || 'Verification failed',
    };
  }

  return {
    isValid: true,
    platformSubscriptionId: result.data?.subscriptionId,
    planId: result.data?.planId,
    expiresAt: result.data?.expiresAt,
  };
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
): Promise<VerificationResult> {
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
        data: {
          error:
            retryError instanceof Error
              ? retryError.message
              : 'Verification failed after retry',
        },
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
 *
 * receiptはJSON文字列またはサブスクリプションID/セッションIDの形式で渡される可能性がある:
 * - JSON: '{"sessionId":"cs_xxx","subscriptionId":"sub_xxx"}'
 * - 直接ID: "cs_xxx" または "sub_xxx"
 */
async function verifyStripeReceipt(
  receipt: string,
  tenantId: string
): Promise<VerificationResult> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const verifier = new StripeVerifier(secret.apiKey);

  // JSON文字列の場合はパースして適切な値を抽出
  let targetId: string;

  try {
    const parsed = JSON.parse(receipt);
    // sessionIdがあればCheckout Session検証を優先
    // subscriptionIdがあればサブスクリプション検証
    targetId = parsed.sessionId || parsed.subscriptionId || receipt;
    console.log('Parsed receipt JSON', {
      hasSessionId: !!parsed.sessionId,
      hasSubscriptionId: !!parsed.subscriptionId,
      targetId,
    });
  } catch {
    // パース失敗時はそのまま使用（直接IDが渡された場合）
    targetId = receipt;
    console.log('Receipt is not JSON, using as-is', { targetId });
  }

  // サブスクリプションIDまたはCheckout Session IDで検証
  if (targetId.startsWith('cs_')) {
    console.log('Verifying as Checkout Session', { sessionId: targetId });
    return verifier.verifyCheckoutSession(targetId);
  } else {
    console.log('Verifying as Subscription', { subscriptionId: targetId });
    return verifier.verify(targetId);
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
