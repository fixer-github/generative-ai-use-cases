# レビュー結果: Lambda Payment-Gateway - Webhook (Stripe)

## 担当ファイル
- `/packages/cdk/lambda/billing/payment-gateway/webhook/stripe/receiveWebhook.ts` (新規追加)
- `/packages/cdk/lambda/billing/payment-gateway/webhook/stripe/eventExtractor.ts` (新規追加)
- `/packages/cdk/lambda/billing/payment-gateway/webhook/stripe/eventMapper.ts` (新規追加)

## 重大な問題（Critical）

### 1. 署名検証の実装に重大な誤り

**場所**: `receiveWebhook.ts` 95-97行目

```typescript
const isValid = verifyStripeSignature(payload, signature, webhookSecret);
```

**問題点**:
`signatureVerifier.ts`の`verifyStripeSignature`関数の実装を確認したところ、17行目で`secret`を**APIキー**として使用しています：

```typescript
const stripe = new Stripe(secret, { apiVersion: '2025-10-29.clover' });
```

これは誤りです。Stripe SDKの初期化にはAPIキーが必要ですが、Webhook署名検証には**Webhook Secret**が必要です。現在の実装では：
- `new Stripe(secret, ...)` でWebhook SecretをAPIキーとして渡している
- その後20行目で`stripe.webhooks.constructEvent(payload, signature, secret)`を呼び出しているが、正しいWebhook Secretで検証できていない

**影響**: 署名検証が正しく動作せず、セキュリティが担保されない重大な脆弱性です。

**推奨対応**: `signatureVerifier.ts`の実装を修正し、Stripe APIキーとWebhook Secretを別々に管理する必要があります。または、Stripe SDKを初期化せずに直接HMAC-SHA256で検証する実装に変更すべきです。


### 2. Secrets Managerのシークレット構造が不明確

**場所**: `receiveWebhook.ts` 28-47行目

```typescript
const secretName = `${tenantId}/billing/stripe`;
const secret = JSON.parse(response.SecretString);
webhookSecretCache[secretName] = secret.webhookSecret;
```

**問題点**:
- Secrets Managerに格納されるJSONの構造（`secret.webhookSecret`フィールド）が定義されていない
- 上記の署名検証の問題により、このシークレットが何を指すのか（APIキーなのかWebhook Secretなのか）が曖昧

**影響**: 運用時にシークレットの設定ミスが発生する可能性が高い

**推奨対応**: シークレットの構造を型定義またはドキュメントで明確にする


### 3. charge.refundedイベントでsubscriptionIdが空

**場所**: `eventExtractor.ts` 207-239行目

```typescript
function extractFromChargeRefunded(...) {
  // ...
  const subscriptionId = ''; // invoiceからの逆引きが必要

  return {
    // ...
    subscriptionId, // 空の場合、統括責務側で補完
```

**問題点**:
- `subscriptionId`は`EventDetail`インターフェースで**必須フィールド**として定義されている
- しかし、返金イベントでは空文字列を返している
- コメントで「統括責務側で補完」とあるが、これは責務分離の設計に反する

**影響**:
- 型定義と実装が矛盾している
- 統括責務側で追加のAPI呼び出しが必要になり、処理の複雑性が増す

**推奨対応**:
1. この段階でStripe APIを呼び出してinvoiceを取得し、subscriptionIdを解決する
2. または、`subscriptionId`をオプショナルにして型定義を修正する

## 警告レベルの問題（Warning）

### 4. イベント抽出失敗時の処理が不適切

**場所**: `receiveWebhook.ts` 166-179行目

```typescript
try {
  eventDetail = await extractEventDetail(stripeEvent, tenantId);
} catch (error) {
  console.error('Failed to extract event details:', error);
  // 抽出失敗時もイベントは受信済みとして扱う
  return {
    statusCode: 200,
    body: JSON.stringify({
      received: true,
      error: 'Failed to extract event details',
    }),
  };
}
```

**問題点**:
- イベント抽出に失敗した場合でも200を返すため、Stripeは再送しない
- しかし、DynamoDBには`processed_status: 'pending'`で保存されているため、イベントが失われる
- EventBridgeにも送信されないため、統括責務側で処理されない

**影響**: データの不整合が発生する可能性

**推奨対応**:
1. 抽出失敗時は500エラーを返し、Stripeに再送させる
2. または、`processed_status: 'error'`で保存し、別途リトライメカニズムを実装する


### 5. userId取得失敗時の処理が不十分

**場所**: `eventExtractor.ts` 複数箇所（例：64-69行目、129-139行目、179-185行目）

```typescript
if (!userId) {
  console.warn(
    `userId not found in invoice metadata. subscriptionId: ${subscriptionId}`
  );
}
```

**問題点**:
- `userId`は`EventDetail`インターフェースで**必須フィールド**（29行目）として定義されている
- しかし、取得できない場合でも警告ログを出すだけで、空文字列を返している
- 型定義と実装が矛盾している

**影響**: 統括責務側でuserIdが空の場合の処理が必要になり、エラーハンドリングが複雑になる

**推奨対応**:
1. userIdが取得できない場合はエラーをthrowする
2. または、型定義を修正して`userId`をオプショナルにする


### 6. エラーハンドリングの一貫性の欠如

**場所**: `receiveWebhook.ts` 205-214行目

```typescript
} catch (error) {
  console.error('Error processing Stripe webhook:', error);

  return {
    statusCode: 500,
    body: JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }),
  };
}
```

**問題点**:
- メインのcatchブロックは500エラーを返す（Stripeが再送する）
- しかし、イベント抽出失敗時（166-179行目）は200を返す（Stripeは再送しない）
- この不整合により、エラーの種類によって冪等性保証の動作が異なる

**影響**: エラーハンドリングの動作が予測しにくく、デバッグが困難

**推奨対応**: エラーハンドリング戦略を統一する


### 7. TTL計算のハードコーディング

**場所**: `receiveWebhook.ts` 131行目

```typescript
const ttl = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // 90日後
```

**問題点**:
- 保存期間がハードコーディングされている
- 環境変数や設定から取得すべき値

**影響**: 保存期間を変更する際にコード修正とデプロイが必要

**推奨対応**: 環境変数から取得するか、定数として定義する


### 8. Stripe APIバージョンの管理

**場所**: `signatureVerifier.ts` 17行目

```typescript
const stripe = new Stripe(secret, { apiVersion: '2025-10-29.clover' });
```

**問題点**:
- Stripe APIバージョンがハードコーディングされている
- 'clover'バージョンは特殊なプレビュー版であり、本番環境での使用には注意が必要
- APIバージョンの管理方針が不明

**影響**: APIバージョン更新時にコード変更が必要

**推奨対応**: 環境変数から取得するか、定数として一元管理する

## 軽微な問題・改善提案（Info）

### 9. 型安全性の向上

**場所**: `eventExtractor.ts` 複数箇所（例：44行目、117行目、211行目）

```typescript
const invoice = stripeEvent.data.object as any;
const charge = stripeEvent.data.object as any;
```

**提案**:
- `as any`を使用せず、Stripe SDKの型を活用する
- 例: `as Stripe.Invoice`, `as Stripe.Charge`


### 10. ログの構造化

**場所**: `receiveWebhook.ts` 複数箇所

```typescript
console.log('Received Stripe webhook request');
console.log(`Processing Stripe webhook for tenant: ${tenantId}`);
```

**提案**:
- ログを構造化して、検索・分析を容易にする
- 例: `console.log(JSON.stringify({ message: 'Processing webhook', tenantId, eventId }))`


### 11. magic numberの定数化

**場所**: `eventExtractor.ts` 79行目

```typescript
const expirationDate = periodEnd
  ? new Date(periodEnd * 1000).toISOString()
  : undefined;
```

**提案**:
- `1000`（ミリ秒変換）を`SECONDS_TO_MILLISECONDS`などの定数にする


### 12. コメントの英語表記

**場所**: 全ファイル

**提案**:
- コードコメントを英語に統一すると、国際的なチームでの保守性が向上する
- ただし、これはプロジェクトの方針次第


### 13. 未使用エクスポート

**場所**: `eventMapper.ts` 26-32行目

```typescript
export function isBusinessEventMappable(stripeEventType: string): boolean {
  return stripeEventType in STRIPE_TO_BUSINESS_EVENT_MAP;
}
```

**提案**:
- この関数が使用されていない場合は削除する
- 使用される予定がある場合は、その旨をコメントで明記する


### 14. テストカバレッジの考慮

**提案**:
以下のシナリオに対するユニットテストが必要：
- 各Stripeイベントタイプの正常系
- 必須フィールドが欠落した場合
- 署名検証失敗
- 重複イベント
- 不正なJSONフォーマット
- Secrets Manager取得失敗


### 15. ドキュメント化

**提案**:
以下をドキュメント化すると保守性が向上：
- Secrets Managerのシークレット構造
- Stripeメタデータに`userId`を設定する方法
- サポートするStripeイベントタイプの一覧
- エラーコードとその意味

## 総合評価

**要修正**

### 評価理由

**重大な問題（Critical）が3件**存在し、特に署名検証の実装誤りはセキュリティに直結する重大な脆弱性です。以下の問題は**本番環境へのデプロイ前に必ず修正が必要**です：

1. **署名検証の修正（最優先）**: `signatureVerifier.ts`の実装を見直し、Webhook Secretで正しく検証する
2. **subscriptionIdの取得**: `charge.refunded`イベントでsubscriptionIdを正しく取得する
3. **シークレット構造の明確化**: Secrets Managerのシークレット構造を定義・ドキュメント化する

### 良い点

- イベントマッピングの設計は明確で拡張性がある
- 冪等性保証のための重複チェック実装がある
- DynamoDBへの永続化とEventBridgeへの転送という責務分離が適切
- エラーログが各所に配置されている

### 改善が望ましい点

- エラーハンドリング戦略の統一（警告レベル問題4, 6）
- 型定義と実装の整合性（警告レベル問題5）
- 環境依存値の外部化（警告レベル問題7, 8）

### 推奨対応順序

1. **第一優先**: 重大な問題1（署名検証）を修正
2. **第二優先**: 重大な問題2, 3を修正
3. **第三優先**: 警告レベル問題4, 5, 6を修正
4. **その後**: 警告レベル問題7, 8および軽微な問題を段階的に改善

修正後、包括的なユニットテストと統合テストを実施することを強く推奨します。
