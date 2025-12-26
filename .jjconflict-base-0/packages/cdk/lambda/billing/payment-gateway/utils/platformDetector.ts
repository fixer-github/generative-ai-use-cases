import { PlatformType } from '../repositories/types';

/**
 * レシート文字列からプラットフォーム種別を判定する
 * @param receipt レシート文字列
 * @returns プラットフォーム種別、判定できない場合はnull
 */
export function detectPlatformFromReceipt(receipt: string): PlatformType | null {
  if (!receipt) {
    return null;
  }

  // Stripe: サブスクリプションIDは "sub_" または "cs_" で始まる
  if (receipt.startsWith('sub_') || receipt.startsWith('cs_') || receipt.startsWith('pi_') || receipt.startsWith('in_')) {
    return 'stripe';
  }

  // Apple: JWSフォーマット（3つのBase64文字列をドットで結合）
  // 形式: header.payload.signature
  const jwtParts = receipt.split('.');
  if (jwtParts.length === 3) {
    try {
      // ヘッダーをデコードして検証
      const header = JSON.parse(Buffer.from(jwtParts[0], 'base64').toString());
      if (header.alg && header.x5c) {
        // Appleの証明書チェーンを含むJWS
        return 'apple';
      }
    } catch (e) {
      // JWSのデコードに失敗した場合はAppleではない
    }
  }

  // Google: Base64エンコードされたJSON形式、または購入トークン形式
  // 購入トークンは長いランダム文字列
  try {
    // Base64デコードを試みる
    const decoded = Buffer.from(receipt, 'base64').toString();
    const parsed = JSON.parse(decoded);

    // Google Play Billingの特徴的なフィールドをチェック
    if (parsed.packageName || parsed.productId || parsed.purchaseToken) {
      return 'google';
    }
  } catch (e) {
    // Base64デコードまたはJSONパースに失敗した場合
    // 長いランダム文字列（購入トークン）の可能性をチェック
    if (receipt.length > 100 && /^[A-Za-z0-9_-]+$/.test(receipt)) {
      return 'google';
    }
  }

  return null;
}

/**
 * プラットフォーム種別から表示名を取得する
 */
export function getPlatformDisplayName(platform: PlatformType): string {
  const displayNames: Record<PlatformType, string> = {
    stripe: 'Stripe Billing',
    apple: 'Apple App Store',
    google: 'Google Play Store',
  };

  return displayNames[platform];
}
