import { createHmac } from 'crypto';
import Stripe from 'stripe';

/**
 * Stripe Webhookの署名を検証する
 * @param payload リクエストボディ（生データ）
 * @param signature stripe-signatureヘッダーの値
 * @param secret Webhook secret
 * @returns 検証成功ならtrue
 */
export function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const stripe = new Stripe(secret, { apiVersion: '2024-11-20.acacia' });

    // Stripe SDKの検証機能を使用
    stripe.webhooks.constructEvent(payload, signature, secret);

    return true;
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    return false;
  }
}

/**
 * Apple JWSの署名を検証する
 * 注: 実際の実装ではAppleのルート証明書を使用した検証が必要
 * ここでは簡易的な検証のみを実装
 * @param jws JWS文字列
 * @returns 検証成功ならtrue
 */
export async function verifyAppleJws(jws: string): Promise<boolean> {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) {
      return false;
    }

    // ヘッダーをデコード
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());

    // ヘッダーに必要なフィールドが含まれているか確認
    if (!header.alg || !header.x5c) {
      return false;
    }

    // 実際の本番環境では、x5c（証明書チェーン）を使用して
    // Appleのルート証明書まで検証する必要があります
    // ここでは構造チェックのみ実装

    // TODO: node-joseまたは類似のライブラリを使用して完全な検証を実装
    // 参考: https://developer.apple.com/documentation/appstoreserverapi/jwstransaction

    return true;
  } catch (err) {
    console.error('Apple JWS verification failed:', err);
    return false;
  }
}

/**
 * Google Pub/Subメッセージの検証
 * 注: Google Cloud Pub/Subからのリクエストは、API Gateway側で
 * Google Cloud認証を使用して検証されることを前提とする
 * @param messageData Base64エンコードされたメッセージデータ
 * @returns 検証成功ならtrue
 */
export function verifyGooglePubSubMessage(messageData: string): boolean {
  try {
    // Base64デコードを試みる
    const decoded = Buffer.from(messageData, 'base64').toString();

    // JSONとしてパースできることを確認
    const parsed = JSON.parse(decoded);

    // 必要なフィールドが含まれているか確認
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }

    return true;
  } catch (err) {
    console.error('Google Pub/Sub message verification failed:', err);
    return false;
  }
}

/**
 * HMAC-SHA256署名を生成する（汎用）
 * @param payload ペイロード
 * @param secret シークレットキー
 * @returns 署名（hex形式）
 */
export function generateHmacSha256Signature(
  payload: string,
  secret: string
): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * HMAC-SHA256署名を検証する（汎用）
 * @param payload ペイロード
 * @param signature 署名
 * @param secret シークレットキー
 * @returns 検証成功ならtrue
 */
export function verifyHmacSha256Signature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateHmacSha256Signature(payload, secret);

  // タイミング攻撃を防ぐため、定数時間比較を使用
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    return false;
  }
}
