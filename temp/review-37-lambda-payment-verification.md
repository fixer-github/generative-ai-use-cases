# レビュー結果: Lambda Payment-Gateway - Verification

## 担当ファイル
- /packages/cdk/lambda/billing/payment-gateway/verification/appleVerifier.ts
- /packages/cdk/lambda/billing/payment-gateway/verification/googleVerifier.ts
- /packages/cdk/lambda/billing/payment-gateway/verification/stripeVerifier.ts
- /packages/cdk/lambda/billing/payment-gateway/verification/verifyReceipt.ts

## 重大な問題（Critical）

### 1. Apple JWT認証が未実装（appleVerifier.ts:83-88）
**問題**: `generateJWT()` メソッドが仮実装のままで、常にエラーをスローする
```typescript
private async generateJWT(): Promise<string> {
  throw new Error(
    'JWT generation not implemented. Need to use App Store Connect API Key.'
  );
}
```
**影響**: Apple App Store Server API (`verify()` メソッド) が全く機能しない
**推奨対応**:
- Secrets Managerからp8キー（App Store Connect API Key）を取得
- JWTライブラリ（jsonwebtoken等）を使用してJWTを生成
- kid（Key ID）、iss（Issuer ID）、aud、iatなど必須クレームを設定

### 2. Apple JWS署名検証の欠落（appleVerifier.ts:95-103）
**問題**: `decodeJWS()` メソッドが署名検証を行わず、単純にBase64デコードのみ実施
```typescript
private decodeJWS(jws: string): any {
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWS format');
  }
  const payload = Buffer.from(parts[1], 'base64').toString();
  return JSON.parse(payload);
}
```
**影響**: 署名検証なしでペイロードを信頼するため、改ざんされたトランザクションデータを受け入れるリスクがある
**推奨対応**:
- Appleの公開鍵（x5c証明書チェーン）を使用して署名を検証
- jose等のライブラリを使用して適切なJWS検証を実装

### 3. Google認証キーの機密情報ログ漏洩リスク（googleVerifier.ts:6-11）
**問題**: serviceAccountKeyがany型で、エラー時にログに出力される可能性がある
```typescript
private serviceAccountKey: any;
constructor(packageName: string, serviceAccountKey: any) {
  this.packageName = packageName;
  this.serviceAccountKey = serviceAccountKey;
}
```
**影響**: サービスアカウントキーがログに露出すると、第三者がGoogle Play APIにアクセス可能になる
**推奨対応**:
- 型を明示的に定義（GoogleAuth.Credentials等）
- エラーログに機密情報が含まれないよう、catch節で適切にフィルタリング

### 4. Secrets Managerのキャッシュに有効期限なし（verifyReceipt.ts:30）
**問題**: `secretsCache` がグローバル変数で無期限にキャッシュされる
```typescript
const secretsCache: Record<string, any> = {};
```
**影響**:
- シークレットローテーション時に古いキーが使われ続ける
- Lambda実行環境の再利用により、長期間キャッシュが残る可能性
**推奨対応**:
- TTL付きキャッシュを実装（例: 5分～1時間）
- シークレットバージョンの管理とキャッシュ無効化の仕組み

## 警告レベルの問題（Warning）

### 5. レート制限への考慮不足（全ファイル）
**問題**: Apple、Google、Stripe各APIのレート制限に対する防御策がない
**影響**:
- Apple: 429エラー時のリトライロジックなし
- Google: quota exceeded時のエラーハンドリング不足
- Stripe: レート制限（100 req/sec）超過時の対応なし
**推奨対応**:
- Exponential backoffによるリトライロジック実装
- API呼び出しのレート制限管理（DynamoDB TTLを使用したカウンター等）
- エラーレスポンスの詳細な分類とリトライ可否の判定

### 6. Apple環境自動切替のセキュリティリスク（appleVerifier.ts:132-136）
**問題**: 本番環境で21007エラー時、自動的にサンドボックス環境で再検証
```typescript
if (data.status === 21007 && this.isProduction) {
  const sandboxVerifier = new AppleVerifier(this.bundleId, false);
  return sandboxVerifier.verifyReceipt(receiptData);
}
```
**影響**: サンドボックスレシートが本番として処理される可能性（環境判定の誤用）
**推奨対応**:
- 自動切替を削除し、明示的なエラー返却
- クライアント側で環境を正しく指定させる

### 7. エラーハンドリングの一貫性欠如
**問題**: 各プラットフォームでエラー処理が異なる
- Google: 一部エラーは `{success: false}` 返却、その他は例外スロー（googleVerifier.ts:88-98）
- Stripe: 同様のパターン（stripeVerifier.ts:57-64）
- Apple: 常に例外スロー（appleVerifier.ts:73-76）
**影響**: 呼び出し側で統一的なエラーハンドリングができない
**推奨対応**: エラー種別（一時的/恒久的、リトライ可否）を明確にし、統一的な返却形式を定義

### 8. プラットフォーム検出の信頼性不足（platformDetector.ts）
**問題**:
- Stripe判定が広範すぎる（`pi_`、`in_` プレフィックス追加、line 14）
- Apple JWS判定が不完全（header検証のみ、x5c証明書の検証なし、line 25）
- Google判定が曖昧（100文字以上のランダム文字列、line 48）
**影響**: 誤ったプラットフォームへのルーティング、検証失敗
**推奨対応**: より厳密な検証ロジック、またはplatformType必須化

### 9. レシートキャッシュのセキュリティ考慮不足（receiptCacheRepository.ts）
**問題**:
- SHA256のみでハッシュ化（salt/pepperなし、line 82）
- キャッシュヒット時の検証結果の再検証なし
**影響**: レインボーテーブル攻撃によるレシート推測の可能性（低リスク）
**推奨対応**:
- HMAC-SHA256の使用を検討
- キャッシュTTL内でも定期的な再検証の検討

### 10. Stripe API Versionのハードコード（stripeVerifier.ts:8）
**問題**: API Versionが `'2025-10-29.clover'` とハードコードされている
```typescript
this.stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });
```
**影響**:
- 未来のAPIバージョンを指定（2025年10月時点で存在しない可能性）
- Stripe APIの破壊的変更に対応できない
**推奨対応**:
- 現在の最新安定版を使用（例: '2024-11-20.acacia'）
- 環境変数で管理可能にする

## 軽微な問題・改善提案（Info）

### 11. 型安全性の向上
**appleVerifier.ts:95**
- `decodeJWS()` の戻り値が `any` 型
- 推奨: トランザクション型インターフェースを定義

**googleVerifier.ts:54**
- `paymentState` の型チェックが不完全
- 推奨: enum定義とtype guard実装

### 12. エラーログの改善
**全ファイル共通**
- `console.error` のみでエラー詳細が不足
- 推奨: 構造化ログ（JSON形式）、エラーコード、トレースID追加

### 13. 定数の外部化
**verifyReceipt.ts:182**
- リトライ待機時間（2秒）がハードコード
**receiptCacheRepository.ts:29**
- キャッシュTTL（24時間）がハードコード
**推奨**: 環境変数または設定ファイルで管理

### 14. Apple bundleId検証の欠落
**appleVerifier.ts:69**
- トランザクションの `bundleId` とコンストラクタの `bundleId` を比較していない
**推奨**: 検証追加で不正なbundleIdのトランザクションを拒否

### 15. Google paymentState判定の改善
**googleVerifier.ts:53-55**
```typescript
const isPaymentReceived = [1, 2, 3].includes(
  subscription.paymentState ?? 0
);
```
- マジックナンバーの使用
**推奨**:
```typescript
enum GooglePaymentState {
  PAYMENT_PENDING = 0,
  PAYMENT_RECEIVED = 1,
  FREE_TRIAL = 2,
  DEFERRED = 3,
}
```

### 16. Stripe拡張パラメータの最適化
**stripeVerifier.ts:21**
```typescript
expand: ['latest_invoice', 'customer']
```
- `latest_invoice` が使用されていない
**推奨**: 必要な拡張のみ指定してAPI呼び出しを最適化

### 17. キャッシュフォールバックの待機時間が固定
**verifyReceipt.ts:182**
```typescript
await new Promise((resolve) => setTimeout(resolve, 2000));
```
- 一律2秒待機はレイテンシ増加の原因
**推奨**: プラットフォーム別、またはエラー種別で待機時間を調整

### 18. VerificationResult型の拡張性不足
**types.ts:13-22**
- `data` フィールドが `Record<string, any>` で型安全性が低い
**推奨**: プラットフォーム別のデータ型定義（Union Type使用）

### 19. Apple expiresDate判定のエッジケース
**appleVerifier.ts:52-55**
```typescript
const expiresDate = transaction.expiresDate
  ? parseInt(transaction.expiresDate, 10)
  : 0;
const isActive = expiresDate > now;
```
- expiresDateが0の場合（一度限りの購入等）を考慮していない
**推奨**: トランザクションタイプに応じた判定ロジック

### 20. Google cancel理由の活用不足
**googleVerifier.ts:76**
- `cancelReason` を返却のみでビジネスロジックに活用していない
**推奨**: cancelReasonに応じた処理分岐（例: ユーザーキャンセル vs システム側キャンセル）

## 総合評価
**要修正**

### 理由
1. **Critical問題が4件**: Apple JWT未実装、JWS署名検証欠落、機密情報漏洩リスク、シークレットキャッシュの問題
2. **セキュリティ面**: 署名検証、認証実装、機密情報管理に重大な懸念
3. **本番運用不可**: Apple検証機能が動作せず、セキュリティリスクが高い

### 修正優先度
1. **最優先**: Apple JWT生成実装、JWS署名検証
2. **高優先**: シークレットキャッシュTTL、レート制限対応、機密情報ログ対策
3. **中優先**: エラーハンドリング統一、プラットフォーム検出改善
4. **低優先**: 型安全性向上、ログ改善、定数外部化

### 推奨事項
- Apple検証機能は現状POC段階として扱い、本番投入前に完全実装が必須
- 各プラットフォームのAPI仕様書に基づく徹底的なテストケース作成
- セキュリティレビュー（特にJWS/JWT検証）の実施
- レート制限を考慮した負荷テストの実施
