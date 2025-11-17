# レビュー結果: Lambda Payment-Gateway - Webhook (Apple & Google)

## 担当ファイル
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts`

## 重大な問題（Critical）

### 1. Apple JWS署名検証が未実装（セキュリティ重大問題）
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L70)
**依存ファイル**: `packages/cdk/lambda/billing/payment-gateway/utils/signatureVerifier.ts` (L36-L63)

**問題**:
- `verifyAppleJws` 関数は構造チェックのみで、**実際の署名検証を行っていない**
- L58で `return true` と常に成功を返しているため、**任意の攻撃者が偽のWebhookを送信可能**
- AppleのルートCA証明書を使用したx5c証明書チェーンの検証が未実装（TODO コメントのみ）

**影響**:
- 悪意のある第三者が偽の購読通知を送信し、不正にサービスを利用できる
- Apple App Store Connect での実際のトランザクションと整合性が取れない

**推奨対応**:
```typescript
// node-jose または @apple/app-store-server-library を使用した実装が必要
// 参考: https://developer.apple.com/documentation/appstoreserverapi/jwstransaction
```

### 2. Google Pub/Sub メッセージ検証が不十分（セキュリティ重大問題）
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L69)
**依存ファイル**: `packages/cdk/lambda/billing/payment-gateway/utils/signatureVerifier.ts` (L72-L90)

**問題**:
- `verifyGooglePubSubMessage` 関数はBase64デコード可能かとJSON構造のチェックのみ
- **Pub/Sub メッセージの真正性を検証していない**
- コメントで「API Gateway側でGoogle Cloud認証を使用」とあるが、Lambda側でも検証すべき

**影響**:
- Base64エンコードされたJSONを送信すれば誰でも通過できる
- 多層防御の観点から不十分

**推奨対応**:
- Google Cloud Pub/Sub の Push 認証トークン（JWT）検証を実装
- または API Gateway での IAM 認証に加え、Lambda側でも追加検証を実施

### 3. JSON.parse() のエラーハンドリング不足
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L58, L84-L86)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L58, L82-L83)

**問題**:
- Apple: L58で `JSON.parse(payload)` が失敗時に500エラーとなり、適切なエラーレスポンスを返せない
- Apple: L84-L86の `JSON.parse(Buffer.from(parts[1], 'base64').toString())` も同様
- Google: L58, L82-L83でも同様の問題

**影響**:
- 不正なペイロードでも500エラーとなり、攻撃者に有用な情報を与える
- 正常な400エラーを返すべき

**推奨対応**:
```typescript
try {
  const notification = JSON.parse(payload);
} catch (e) {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Invalid JSON payload' }),
  };
}
```

## 警告レベルの問題（Warning）

### 4. 環境変数の検証が不十分
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L26, L35-L40)

**問題**:
- `APPLE_BUNDLE_ID` を取得しているが、実際には使用されていない（L26で取得、その後未使用）
- 不要な環境変数チェックが含まれている

**推奨対応**:
- 実際に使用する場合は signature 検証時に bundleId を検証
- 使用しない場合は環境変数取得とチェックを削除

### 5. Base64デコード時のエラーハンドリング不足
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L84-L86)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L82)

**問題**:
- `Buffer.from(parts[1], 'base64')` や `Buffer.from(messageData, 'base64')` が不正なBase64で失敗時に500エラー
- try-catchで捕捉されるが、400エラーとして明示的に処理すべき

**推奨対応**:
```typescript
let decodedPayload;
try {
  decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
} catch (e) {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Invalid base64 encoding' }),
  };
}
```

### 6. DynamoDB保存とEventBridge送信の原子性保証なし
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L126, L150)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L126, L150)

**問題**:
- DynamoDB保存 (L126) 成功後、EventBridge送信 (L150) が失敗した場合、イベントがpending状態で残る
- EventBridge送信失敗時のリトライ戦略が不明確

**影響**:
- イベントが保存されているが、後続処理が実行されない可能性
- 冪等性は保証されるが、データ不整合が発生しうる

**推奨対応**:
- Step Functions や SQS による非同期処理への変更を検討
- またはEventBridge送信失敗時にDynamoDBのステータスを更新するロジックを追加

### 7. 重複イベントのログ出力レベルが不適切
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L105)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L105)

**問題**:
- 重複イベント検出時に `console.log` を使用しているが、これは正常な動作
- `console.info` または構造化ログとして記録すべき

**推奨対応**:
```typescript
console.info(`Duplicate event detected: ${notificationUUID}`, {
  eventId: notificationUUID,
  tenantId,
  platform: 'apple',
  duplicate: true,
});
```

## 軽微な問題・改善提案（Info）

### 8. EventBridge Detail の構造が一貫していない可能性
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L138-L143)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L138-L143)

**提案**:
- Apple と Google で Detail の構造を統一
- 共通の型定義を作成して型安全性を向上

### 9. コンソールログの構造化
**ファイル**: 両ファイル全般

**提案**:
- CloudWatch Logs Insights での分析を容易にするため、構造化ログ（JSON形式）を採用
- ログレベル（INFO, WARN, ERROR）を明確化

**推奨対応例**:
```typescript
console.log(JSON.stringify({
  level: 'INFO',
  message: 'Processing Apple notification',
  tenantId,
  eventId: notificationUUID,
  platform: 'apple',
}));
```

### 10. TTL計算の定数化
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L114)
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L114)

**提案**:
```typescript
const TTL_DAYS = 90;
const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 60 * 60;
```

### 11. Google notificationType のフォールバック値
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts` (L87-L89, L120)

**問題**:
- L87-89で `notificationType` を抽出するが、L120で `|| 'unknown'` とフォールバック
- しかしL141のEventBridgeではフォールバックなしで送信される可能性

**推奨対応**:
```typescript
const notificationType =
  notification.subscriptionNotification?.notificationType?.toString() ||
  notification.testNotification?.version?.toString() ||
  'unknown';
```

### 12. Apple JWS parts の長さチェック不足
**ファイル**: `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts` (L83-L86)

**提案**:
- `signatureVerifier.ts` では `parts.length !== 3` をチェックしているが、receiveNotification.ts では未チェック
- 二重チェックまたはverifyAppleJws内でpartsを返すように修正

### 13. 型安全性の向上
**ファイル**: 両ファイル

**提案**:
- `decodedPayload`, `notification` の型を定義
- Apple: `AppleServerNotification` 型
- Google: `GoogleRtdnNotification` 型

### 14. WebhookEventRepository初期化のタイミング
**ファイル**: 両ファイル (L99)

**提案**:
- リポジトリ初期化をtryブロック外で行うことで、接続エラーを早期検出可能

### 15. エラーレスポンスの一貫性
**ファイル**: 両ファイル

**観察**:
- エラーメッセージの形式が統一されている点は良い
- ただし、エラーコードやエラータイプを追加すると、クライアント側での処理が容易になる

**推奨対応例**:
```typescript
{
  statusCode: 400,
  body: JSON.stringify({
    error: 'Missing payload',
    errorCode: 'MISSING_PAYLOAD',
    platform: 'apple',
  }),
}
```

## 総合評価

**要修正**

### 理由:
1. **Critical問題が3件**: 特にApple/Googleの署名検証が実装されていない点は致命的なセキュリティ脆弱性
2. **Warning問題が4件**: エラーハンドリング不足、原子性保証なしなど、本番運用で問題となる可能性が高い

### 優先度:
1. **最優先（P0）**: Apple JWS署名検証の実装（問題1）
2. **最優先（P0）**: Google Pub/Sub認証の実装（問題2）
3. **高優先度（P1）**: JSON.parse() エラーハンドリング（問題3）
4. **中優先度（P2）**: Base64デコードエラーハンドリング（問題5）
5. **中優先度（P2）**: DynamoDB/EventBridge原子性保証（問題6）

### 肯定的な点:
- 冪等性の考慮（重複チェック）は適切に実装されている
- エラーハンドリングの基本構造は整っている
- テナントIDベースのマルチテナント設計が適切
- TTL設定による自動削除の実装は良い
- EventBridgeを使用した疎結合アーキテクチャは適切

### 次のステップ:
1. 署名検証の完全な実装（Apple: x5c証明書チェーン、Google: JWT検証）
2. エラーハンドリングの強化
3. 統合テストの作成（特に不正なペイロードに対するテスト）
4. セキュリティレビューの実施
