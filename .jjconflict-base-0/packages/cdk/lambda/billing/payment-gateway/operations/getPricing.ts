import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType } from '../repositories/types';

/**
 * 価格情報の型
 */
export interface PricingInfo {
  productId: string;
  priceId: string;
  amount: number;
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
}

/**
 * エラーレスポンスの型
 */
export interface PricingError {
  error: string;
  message: string;
}

/**
 * キャッシュエントリの型
 */
interface CacheEntry {
  data: PricingInfo;
  timestamp: number;
}

/**
 * 価格情報のキャッシュ（TTL: 300秒）
 */
const pricingCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 300 * 1000; // 300秒

/**
 * Stripe APIキーのキャッシュ
 */
let stripeApiKeyCache: string | null = null;

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache) {
    return stripeApiKeyCache;
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  stripeApiKeyCache = secret.apiKey;

  return stripeApiKeyCache!;
}

/**
 * キャッシュキーを生成する
 */
function getCacheKey(
  tenantId: string,
  platformProductId: string,
  platformType: PlatformType
): string {
  return `${tenantId}:${platformType}:${platformProductId}`;
}

/**
 * キャッシュから価格情報を取得する
 */
function getFromCache(cacheKey: string): PricingInfo | null {
  const entry = pricingCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  // TTLチェック
  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    pricingCache.delete(cacheKey);
    return null;
  }

  console.log('Cache hit for pricing:', cacheKey);
  return entry.data;
}

/**
 * キャッシュに価格情報を保存する
 */
function saveToCache(cacheKey: string, data: PricingInfo): void {
  pricingCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
  console.log('Saved to cache:', cacheKey);
}

/**
 * Stripeから価格情報を取得する
 */
async function getStripePricing(
  tenantId: string,
  platformProductId: string
): Promise<PricingInfo> {
  const apiKey = await getStripeApiKey(tenantId);
  const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

  console.log('Fetching price from Stripe:', platformProductId);

  try {
    // Stripeの価格情報を取得
    const price = await stripe.prices.retrieve(platformProductId, {
      expand: ['product'],
    });

    if (!price.unit_amount) {
      throw new Error('Price amount not found');
    }

    // 製品情報を取得
    const product = price.product as Stripe.Product;

    return {
      productId: typeof product === 'string' ? product : product.id,
      priceId: price.id,
      amount: price.unit_amount,
      currency: price.currency.toUpperCase(),
      interval: price.recurring?.interval || 'month',
      intervalCount: price.recurring?.interval_count || 1,
    };
  } catch (error) {
    console.error('Error fetching Stripe price:', error);
    throw new Error(
      `Failed to fetch price from Stripe: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * 価格情報を取得するメイン関数
 *
 * @param tenantId - テナントID
 * @param platformProductId - プラットフォーム固有の製品ID（StripeのpriceId等）
 * @param platformType - プラットフォームタイプ（stripe, apple, google）
 * @returns 価格情報またはエラー
 */
export async function getPricing(
  tenantId: string,
  platformProductId: string,
  platformType: PlatformType
): Promise<PricingInfo | PricingError> {
  console.log('Get pricing request:', {
    tenantId,
    platformProductId,
    platformType,
  });

  try {
    // パラメータの検証
    if (!tenantId || !platformProductId || !platformType) {
      return {
        error: 'INVALID_PARAMETERS',
        message: 'tenantId, platformProductId, and platformType are required',
      };
    }

    // キャッシュキーを生成
    const cacheKey = getCacheKey(tenantId, platformProductId, platformType);

    // キャッシュから取得を試みる
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    // プラットフォームごとに価格情報を取得
    let pricingInfo: PricingInfo;

    switch (platformType) {
      case 'stripe':
        pricingInfo = await getStripePricing(tenantId, platformProductId);
        break;

      case 'apple':
        console.log('Apple platform not yet implemented');
        return {
          error: 'NOT_IMPLEMENTED',
          message: 'Apple platform pricing is not yet implemented',
        };

      case 'google':
        console.log('Google platform not yet implemented');
        return {
          error: 'NOT_IMPLEMENTED',
          message: 'Google platform pricing is not yet implemented',
        };

      default:
        return {
          error: 'INVALID_PLATFORM',
          message: `Unsupported platform type: ${platformType}`,
        };
    }

    // キャッシュに保存
    saveToCache(cacheKey, pricingInfo);

    return pricingInfo;
  } catch (error) {
    console.error('Error in getPricing:', error);
    return {
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * 複数の価格情報を一括取得する
 *
 * @param tenantId - テナントID
 * @param requests - 価格情報リクエストの配列
 * @returns 価格情報の配列
 */
export async function getBatchPricing(
  tenantId: string,
  requests: Array<{
    platformProductId: string;
    platformType: PlatformType;
  }>
): Promise<Array<PricingInfo | PricingError>> {
  console.log('Get batch pricing request:', {
    tenantId,
    requestCount: requests.length,
  });

  // 並列で価格情報を取得
  const promises = requests.map((req) =>
    getPricing(tenantId, req.platformProductId, req.platformType)
  );

  return Promise.all(promises);
}