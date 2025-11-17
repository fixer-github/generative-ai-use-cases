# レビュー結果: Lambda Payment-Gateway - Types & Utils

## 担当ファイル
- packages/cdk/lambda/billing/payment-gateway/types/businessEvent.ts
- packages/cdk/lambda/billing/payment-gateway/utils/eventDeduplicator.ts
- packages/cdk/lambda/billing/payment-gateway/utils/platformDetector.ts
- packages/cdk/lambda/billing/payment-gateway/utils/signatureVerifier.ts

## 重大な問題（Critical）

### 1. signatureVerifier.ts: Stripe初期化パラメータの誤用
**ファイル**: `signatureVerifier.ts` (L17)
**問題**:
```typescript
const stripe = new Stripe(secret, { apiVersion: '2025-10-29.clover' });
```
- `new Stripe()` の第1引数に `secret` (Webhook Secret) を渡していますが、これは本来 **APIキー** を渡すべき箇所です
- Webhook Secretは `stripe.webhooks.constructEvent()` の第3引数で使用されるため、Stripeインスタンス化時には別のAPIキーが必要です
- 現状では署名検証が正常に機能しません

**影響**: 重大なセキュリティ脆弱性。不正なWebhookリクエストが検証を通過する可能性があります

### 2. signatureVerifier.ts: Apple JWS検証の実装不足
**ファイル**: `signatureVerifier.ts` (L36-63)
**問題**:
```typescript
export async function verifyAppleJws(jws: string): Promise<boolean> {
  // ... 構造チェックのみ
  // TODO: node-joseまたは類似のライブラリを使用して完全な検証を実装
  return true; // 常にtrueを返す
}
```
- JWSの構造チェックのみで、実際の署名検証を行っていません
- TODOコメントがありますが、本番環境での使用には不適切です

**影響**: 重大なセキュリティ脆弱性。偽造されたAppleの通知を検証できません

### 3. signatureVerifier.ts: Google Pub/Sub検証の不十分さ
**ファイル**: `signatureVerifier.ts` (L72-90)
**問題**:
```typescript
export function verifyGooglePubSubMessage(messageData: string): boolean {
  // Base64デコードとJSONパースのみ
  return true;
}
```
- コメントで「API Gateway側で検証されることを前提とする」と記載されていますが、関数自体は実質的な検証を行っていません
- Base64デコードとJSON形式チェックだけでは、メッセージの真正性を保証できません

**影響**: セキュリティリスク。外部から偽装されたPub/Subメッセージを受け入れる可能性があります

## 警告レベルの問題（Warning）

### 4. businessEvent.ts: プラットフォーム型の不一致
**ファイル**: `businessEvent.ts` (L15)
**問題**:
```typescript
export interface EventDetail {
  platform: 'stripe' | 'apple' | 'google';
  // ...
}
```
- `repositories/types.ts` に既に `PlatformType` 型が定義されています
- 型の二重定義により、保守性が低下します

**推奨**: `PlatformType` をインポートして再利用すべきです

### 5. businessEvent.ts: 必須フィールドの妥当性
**ファイル**: `businessEvent.ts` (L32-33)
**問題**:
```typescript
planId?: string;
```
- プランIDがオプショナルになっていますが、すべてのビジネスイベント（特に `payment.succeeded`）でプランIDは重要な情報です
- プランIDがない場合の処理方針が不明確です

**推奨**: プランID取得が必須になるケースを明確化し、必要に応じてバリデーションを強化すべきです

### 6. platformDetector.ts: Stripe判定ロジックの脆弱性
**ファイル**: `platformDetector.ts` (L14)
**問題**:
```typescript
if (receipt.startsWith('sub_') || receipt.startsWith('cs_') || receipt.startsWith('pi_') || receipt.startsWith('in_')) {
  return 'stripe';
}
```
- プレフィックスのみでの判定は誤検出の可能性があります
- ユーザーが意図的に `sub_` で始まる文字列を入力した場合、誤ってStripeと判定されます

**推奨**: 追加のパターン検証（例: 長さ、文字種）を組み合わせるべきです

### 7. platformDetector.ts: Google判定ロジックの曖昧さ
**ファイル**: `platformDetector.ts` (L48)
**問題**:
```typescript
if (receipt.length > 100 && /^[A-Za-z0-9_-]+$/.test(receipt)) {
  return 'google';
}
```
- 100文字以上の英数字文字列を全てGoogleと判定するのは危険です
- Stripeの他のトークンタイプとも衝突する可能性があります

**推奨**: Googleの購入トークンの具体的な特徴（長さ範囲、パターン）を調査し、より厳密な判定基準を設けるべきです

### 8. eventDeduplicator.ts: パフォーマンスの懸念
**ファイル**: `eventDeduplicator.ts` (L27-30)
**問題**:
```typescript
const checkPromises = eventIds.map(async (eventId) => {
  const isDuplicate = await isDuplicateEvent(eventId, repository);
  return { eventId, isDuplicate };
});
```
- 各イベントIDに対してDynamoDBへの個別クエリを実行しています
- 大量のイベントIDがある場合、パフォーマンスとコストの問題が発生します

**推奨**: DynamoDB BatchGetItemを使用したバッチ取得に最適化すべきです

### 9. signatureVerifier.ts: Stripe APIバージョンの問題
**ファイル**: `signatureVerifier.ts` (L17)
**問題**:
```typescript
const stripe = new Stripe(secret, { apiVersion: '2025-10-29.clover' });
```
- APIバージョン `2025-10-29.clover` は将来の日付で、かつ非標準のバージョン識別子です
- Stripe APIバージョンは通常 `YYYY-MM-DD` 形式です（`.clover` は不明）

**推奨**: 現在安定しているStripe APIバージョンを使用すべきです

## 軽微な問題・改善提案（Info）

### 10. businessEvent.ts: ドキュメントの充実
**提案**: 各イベントタイプがどのような状況で発生するか、どのフィールドが必須になるかの詳細な仕様をコメントに記載すると良いでしょう

例:
```typescript
/**
 * payment.succeeded: 支払い更新成功
 * - amount, currency, platformPaymentId は必須
 * - planId は Stripe/Google では取得可能、Apple では不明な場合あり
 */
```

### 11. eventDeduplicator.ts: エラーハンドリング
**提案**: `isDuplicateEvent` でリポジトリエラーが発生した場合の処理を明確にすべきです

現状では例外が上位に伝播しますが、ログ記録やリトライロジックを検討すべきです

### 12. platformDetector.ts: Apple JWS判定の堅牢性
**ファイル**: `platformDetector.ts` (L24)
**提案**:
```typescript
const header = JSON.parse(Buffer.from(jwtParts[0], 'base64').toString());
```
- Base64デコードが失敗する可能性に対するエラーハンドリングは既にありますが、`Buffer.from()` のエンコーディング指定（'utf-8'）を明示するとより安全です

### 13. signatureVerifier.ts: エラーログの改善
**提案**: 各検証関数のエラーログに、より詳細な情報（エラーの種類、スタックトレース）を含めると、トラブルシューティングが容易になります

```typescript
console.error('Stripe signature verification failed:', {
  error: err.message,
  stack: err.stack
});
```

### 14. 型安全性の向上
**提案**: `businessEvent.ts` の `eventData: Record<string, any>` は型安全性を損なうため、可能であればプラットフォーム別の型定義を用意すると良いでしょう

```typescript
type StripeEventData = { /* ... */ };
type AppleEventData = { /* ... */ };
type GoogleEventData = { /* ... */ };

interface EventDetail<T = Record<string, any>> {
  // ...
  eventData: T;
}
```

### 15. ユニットテストの必要性
**提案**: 特に `platformDetector.ts` と `signatureVerifier.ts` については、境界値テストや異常系テストのカバレッジを確保すべきです

## 総合評価

**要修正**

### 評価理由
1. **Critical問題が3件**: 特に署名検証の実装が不完全で、本番環境では重大なセキュリティリスクとなります
2. **Warning問題が6件**: プラットフォーム検出ロジックの精度やパフォーマンス面での懸念があります
3. **ビジネスイベント型定義**: 基本構造は適切ですが、型の再利用や必須フィールドの妥当性に改善の余地があります
4. **イベント重複排除**: 基本機能は実装されていますが、パフォーマンス最適化が必要です
5. **プラットフォーム検出**: ヒューリスティックなアプローチは良いですが、誤判定リスクの軽減が必要です
6. **署名検証**: Apple・Googleの検証が不十分で、Stripeの検証も実装エラーがあります

### 優先対応事項
1. **最優先**: `signatureVerifier.ts` の3つのCritical問題を修正
   - Stripe: 正しいAPIキーとWebhook Secretの使い分け
   - Apple: 完全なJWS署名検証の実装
   - Google: Pub/Sub認証の適切な実装または明示的なドキュメント化
2. **高優先**: プラットフォーム検出ロジックの精度向上
3. **中優先**: DynamoDB BatchGetItemを使用したパフォーマンス最適化
