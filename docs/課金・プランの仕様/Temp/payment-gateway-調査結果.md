# Payment Gateway責務 調査結果

## 調査概要

- **調査日時**: 2025-11-14
- **調査対象ディレクトリ**: `packages/cdk/lambda/billing/payment-gateway/`
- **調査対象ファイル数**: 20ファイル（TypeScript実装ファイルのみ、型定義ファイルを除く）
- **参照ドキュメント**: `docs/課金・プランの仕様/購入・変更・解約などの複数ステップの処理を統括する/技術実装詳細.md`

## verifyReceipt関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/verification/verifyReceipt.ts`

### シグネチャの一致度: **部分一致**

#### 技術実装詳細.mdの期待シグネチャ
```typescript
paymentGatewayClient.verifyReceipt(platform, receiptData)
// 出力: 検証結果（isValid, subscriptionId等）
```

#### 実際の実装シグネチャ
```typescript
// Lambda handler（API Gateway経由）
handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>

// 内部関数
verifyReceiptWithFallback(
  platformType: PlatformType,
  receipt: string,
  tenantId: string,
  cacheRepository: ReceiptCacheRepository,
  subscriptionId?: string
): Promise<VerificationResult>
```

### 問題点

1. **呼び出しインターフェースの不一致**
   - 技術実装詳細では、統括責務が`paymentGatewayClient.verifyReceipt(platform, receiptData)`という形式で**Lambda同期呼び出し**することを期待
   - 実際の実装は**API Gatewayエンドポイント**として公開されており、HTTPリクエスト経由でのみ呼び出し可能
   - 統括責務から直接Lambda invokeで呼び出すことは可能だが、リクエスト形式がAPI Gatewayイベントを前提としているため、統括責務側で`APIGatewayProxyEvent`形式にラップする必要がある

2. **関数シグネチャの複雑性**
   - Google検証の場合、`subscriptionId`が必須パラメータとして要求される
   - 統括責務側でプラットフォームごとに異なるパラメータを意識する必要がある

3. **出力形式の一貫性**
   - API Gatewayレスポンスとして`statusCode`と`body`（JSON文字列）を返す
   - 統括責務がLambda invokeで呼び出す場合、レスポンスペイロードから`body`をパースして`VerificationResult`を取り出す必要がある

### 実装内容の評価

**良い点**:
- レシート検証キャッシュ機構が実装済み（`ReceiptCacheRepository`）
- フォールバック処理（キャッシュ参照 → 2秒待機 → 再試行）が実装済み
- 3つのプラットフォーム（Stripe、Apple、Google）すべてに対応

**改善が必要な点**:
- 統括責務から呼び出しやすいように、Internal用のLambda関数（API Gateway非依存）を別途作成すべき

## updateSubscription関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/operations/updateSubscription.ts`

### シグネチャの一致度: **部分一致**

#### 技術実装詳細.mdの期待シグネチャ
```typescript
paymentGatewayClient.updateSubscription(platform, subscriptionId, newPlanId, prorate)
```

#### 実際の実装シグネチャ
```typescript
// Lambda handler（API Gateway経由）
handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>

// リクエストボディ
interface UpdateSubscriptionRequest {
  platformType: PlatformType;
  subscriptionId: string;
  newPriceId: string;  // 技術実装詳細では "newPlanId"
  isUpgrade: boolean;  // 技術実装詳細では "prorate"
}
```

### 問題点

1. **パラメータ名の不一致**
   - `newPlanId` → `newPriceId`（実装では"Price ID"と呼んでいる）
   - `prorate` → `isUpgrade`（実装ではアップグレード判定のブール値）
   - 技術実装詳細の意図とは異なるパラメータ形式

2. **prorateの解釈違い**
   - 技術実装詳細では`prorate: true/false`で「日割り請求の有無」を直接制御する想定
   - 実装では`isUpgrade`から`proration_behavior`を推論（`'always_invoice'` or `'none'`）
   - アップグレード/ダウングレード以外のシナリオ（同じ価格帯での変更など）に対応していない

3. **プラットフォーム制限の明示**
   - Appleはサーバー側からのプラン変更不可（400エラーを返す）
   - Googleは部分的サポート（実際にはクライアント側処理が必要）
   - これらの制限が技術実装詳細に明記されていない

4. **呼び出しインターフェースの不一致**
   - `verifyReceipt`と同様、API Gatewayエンドポイントとして実装されており、統括責務からのLambda同期呼び出しには適していない

### 実装内容の評価

**良い点**:
- Stripeのプラン変更が正しく実装されている（アップグレード時は即時、ダウングレード時は次回更新時）
- プラットフォーム別の制約を適切にハンドリング

**改善が必要な点**:
- パラメータ名を技術実装詳細と一致させる
- Internal用のLambda関数を別途作成

## cancelSubscription関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/operations/cancelSubscription.ts`

### シグネチャの一致度: **部分一致**

#### 技術実装詳細.mdの期待シグネチャ
```typescript
paymentGatewayClient.cancelSubscription(platform, subscriptionId, atPeriodEnd)
```

#### 実際の実装シグネチャ
```typescript
// Lambda handler（API Gateway経由）
handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>

// リクエストボディ
interface CancelSubscriptionRequest {
  platformType: PlatformType;
  subscriptionId: string;
  cancelImmediately: boolean;  // 技術実装詳細では "atPeriodEnd"（論理が逆）
  packageName?: string;        // Google固有
  purchaseToken?: string;      // Google固有
}
```

### 問題点

1. **パラメータの論理が逆**
   - 技術実装詳細: `atPeriodEnd: true`（期限終了時にキャンセル）
   - 実装: `cancelImmediately: true`（即時キャンセル）
   - 命名の違いにより、呼び出し側で混乱が生じる可能性

2. **Google固有パラメータの存在**
   - `packageName`と`purchaseToken`が必須
   - 技術実装詳細ではこれらのパラメータが言及されていない
   - 統括責務がこれらの情報を事前に把握している必要がある

3. **プラットフォーム制限**
   - Appleはサーバー側からのキャンセル不可（400エラーを返す）
   - 技術実装詳細に明記されていない

4. **呼び出しインターフェースの不一致**
   - 同様に、API Gatewayエンドポイントとして実装

### 実装内容の評価

**良い点**:
- Stripeの2パターン（即時キャンセル/期限終了時キャンセル）を正しく実装
- Googleのキャンセル処理が実装済み
- 各プラットフォームの制約を適切にハンドリング

**改善が必要な点**:
- パラメータ名を技術実装詳細と一致させる（`atPeriodEnd`に変更、または技術実装詳細を修正）
- Internal用のLambda関数を別途作成

## Webhookエンドポイント

### 実装状況: **実装済み**

### 実装ファイル
- Stripe: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/webhook/stripe/receiveWebhook.ts`
- Apple: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts`
- Google: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts`

### 署名検証: **実装済み**

実装ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/utils/signatureVerifier.ts`

- **Stripe**: `verifyStripeSignature()` - Stripe SDKを使用した署名検証（実装済み）
- **Apple**: `verifyAppleJws()` - JWS検証（構造チェックのみ、完全な証明書チェーン検証は未実装）
- **Google**: `verifyGooglePubSubMessage()` - Base64デコード + JSON検証（実装済み、ただしGoogle Cloud認証はAPI Gateway側で実施する前提）

### 重複チェック: **実装済み**

実装ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/utils/eventDeduplicator.ts`

- `isDuplicateEvent()` - DynamoDB上のWebhookイベント履歴テーブルを参照して重複チェック
- 重複イベントは200レスポンスを返して冪等性を保証

### EventBridge連携: **実装済み**

- `EventBridgeClient`を使用して`PutEventsCommand`でイベントを送信
- イベント送信先: `billing.payment-gateway`ソース
- DetailTypeはビジネスイベントにマッピング済み（`eventMapper.ts`、`eventExtractor.ts`使用）
- 技術実装詳細に記載された形式（Source: `billing.payment-gateway`、DetailType: プラットフォーム固有）に準拠

### 実装内容の評価

**良い点**:
- 3つのプラットフォームすべてのWebhookエンドポイントを実装
- 署名検証、重複チェック、EventBridge送信が正しく実装されている
- Webhookイベント履歴テーブル（`WebhookEventRepository`）でイベントを永続化
- TTL（90日）が設定されている

**問題点**:
1. **Apple JWS署名検証が不完全**
   - コメントに「TODO: node-joseまたは類似のライブラリを使用して完全な検証を実装」と記載
   - 現状は構造チェックのみで、Appleのルート証明書までの証明書チェーン検証が未実装
   - **セキュリティリスク**: 悪意あるリクエストを検証なしで受け入れる可能性

2. **Google署名検証の責任分界点が不明確**
   - コメントに「API Gateway側でGoogle Cloud認証を使用して検証されることを前提」と記載
   - しかし、CDK定義では特にGoogle Cloud認証の設定が見当たらない
   - **セキュリティリスク**: Google Pub/Subからの正当なリクエストかどうかを確認できない

## レシート検証キャッシュ機構

### 実装状況: **実装済み**

実装ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/payment-gateway/repositories/receiptCacheRepository.ts`

### 実装内容

- **キャッシュテーブル**: `${tenantId}-payment-gateway-receipt-cache`（DynamoDB）
- **TTL**: 24時間
- **ハッシュ化**: レシート文字列をSHA256でハッシュ化してプライマリキーとして使用
- **キャッシュヒット時の処理**: `cached: true`フラグを付けて結果を返す
- **キャッシュミス時の処理**: `verifyReceipt.ts`内で2秒待機後に再検証を試行

### 実装内容の評価

**良い点**:
- 技術実装詳細の要件を満たしている
- TTL、ハッシュ化、キャッシュフラグなど、適切に実装されている

**問題点**:
- 特になし（要件を満たしている）

## CDK Construct定義

### 実装状況: **実装済み**

実装ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/payment-gateway.ts`

### 実装内容

- **Webhookエンドポイント**: Stripe、Apple、Googleの3つのWebhook Lambda関数を定義
- **決済操作関数**: `verifyReceipt`、`createCheckoutSession`、`updateSubscription`、`cancelSubscription`、`getInvoice`を定義
- **IAMポリシー**: 必要な権限（DynamoDB、Secrets Manager、EventBridge、Cognito）を付与
- **API Gatewayエンドポイント**: すべての関数をAPIエンドポイントとして公開

### 公開プロパティ

```typescript
public readonly verifyReceiptFunction: NodejsFunction;
public readonly createCheckoutSessionFunction: NodejsFunction;
public readonly updateSubscriptionFunction: NodejsFunction;
public readonly cancelSubscriptionFunction: NodejsFunction;
```

### 問題点

1. **統括責務からの呼び出しインターフェースが不適切**
   - 技術実装詳細では、統括責務が`paymentGatewayFunctions`プロパティを通じて関数を呼び出す想定
   - 実際の実装では、公開されている関数はすべてAPI Gateway経由の呼び出しを前提としている
   - 統括責務がLambda同期呼び出し（`InvokeCommand`）で呼び出す際、`APIGatewayProxyEvent`形式に整形する必要があり、煩雑

2. **技術実装詳細との命名の不一致**
   - 技術実装詳細: `paymentGatewayFunctions.verifyReceipt`（optional）
   - 実装: `verifyReceiptFunction`（必須プロパティ）
   - 技術実装詳細では`verifyReceipt`以外の関数がoptionalとして記載されているが、実装ではすべてpublicプロパティとして公開

3. **Internal関数が存在しない**
   - 技術実装詳細では、統括責務が他の責務の「Internal関数」を呼び出す設計
   - Payment Gateway責務には、統括責務専用のInternal関数が存在せず、すべてAPI Gatewayエンドポイントとして公開されている

## 統括責務が動作する上で必須の修正事項

### 1. Internal Lambda関数の新規作成（最優先）

**必要な理由**: 統括責務は`paymentGatewayClient`を通じてLambda同期呼び出し（`InvokeCommand`）でPayment Gateway関数を呼び出す設計だが、現在の関数はすべてAPI Gateway経由の呼び出しを前提としており、直接呼び出しに適していない。

**対応内容**:
- `verifyReceipt`、`updateSubscription`、`cancelSubscription`のInternal版Lambda関数を新規作成
- 入力: プレーンなJSONオブジェクト（API Gatewayイベント形式ではない）
- 出力: プレーンなJSONオブジェクト（`statusCode`や`body`ラップなし）
- 配置場所: `packages/cdk/lambda/billing/payment-gateway/internal/`

**実装例**:
```typescript
// packages/cdk/lambda/billing/payment-gateway/internal/verifyReceipt.ts

export interface VerifyReceiptInput {
  platform: PlatformType;
  receiptData: string;
  subscriptionId?: string; // Google用
}

export async function handler(input: VerifyReceiptInput): Promise<VerificationResult> {
  // API Gatewayイベント形式への変換なしで直接処理
  // ...
}
```

### 2. CDK Constructでの公開プロパティ修正

**必要な理由**: 技術実装詳細に記載された`OrchestrationApiProps`の型定義と一致させる必要がある。

**対応内容**:
- `PaymentGatewayApi`のコンストラクタで、Internal関数を`internalFunctions`プロパティとして公開
- 型定義を技術実装詳細と一致させる

**実装例**:
```typescript
// packages/cdk/lib/construct/api/payment-gateway.ts

public readonly internalFunctions = {
  verifyReceipt: this.verifyReceiptInternalFunction,
  updateSubscription: this.updateSubscriptionInternalFunction,
  cancelSubscription: this.cancelSubscriptionInternalFunction,
};
```

### 3. パラメータ名の統一

**必要な理由**: 統括責務が技術実装詳細に基づいてClient関数を実装するため、パラメータ名が一致していないと実装時に混乱が生じる。

**対応内容**:
- `updateSubscription`の`newPriceId` → `newPlanId`、`isUpgrade` → `prorate`に変更
- `cancelSubscription`の`cancelImmediately` → `atPeriodEnd`に変更（論理を反転）

### 4. Apple JWS署名検証の完全実装

**必要な理由**: 現状の署名検証は構造チェックのみで、Appleのルート証明書までの証明書チェーン検証が未実装。悪意あるリクエストを受け入れるセキュリティリスクがある。

**対応内容**:
- `node-jose`または類似のライブラリを使用してJWS署名検証を実装
- Appleのルート証明書を使用した証明書チェーン検証を追加

**参考リンク**: https://developer.apple.com/documentation/appstoreserverapi/jwstransaction

### 5. Google Pub/Sub認証の明確化

**必要な理由**: 現状のコメントでは「API Gateway側でGoogle Cloud認証を使用」とあるが、実際のCDK定義では該当する設定が見当たらない。

**対応内容**:
- API GatewayでGoogle Cloud認証（Push Subscriptionの署名検証）を設定するか、Lambda関数内で署名検証を実装
- 技術実装詳細に認証方法を明記

## 補足事項

### 1. 実装の完成度

Payment Gateway責務は、以下の点で高い完成度を持っています:
- 3つのプラットフォーム（Stripe、Apple、Google）すべてに対応
- Webhookエンドポイント、署名検証、重複チェック、EventBridge連携がすべて実装済み
- レシート検証キャッシュ機構が実装済み
- DynamoDBテーブル（Webhookイベント履歴、レシートキャッシュ）が適切に設計されている

### 2. 主要な問題点

最大の問題は、**統括責務からの呼び出しインターフェースが技術実装詳細と異なる**ことです:
- 技術実装詳細: Lambda同期呼び出しでInternal関数を直接呼び出す想定
- 実装: API Gatewayエンドポイントとして公開されており、HTTPリクエスト形式での呼び出しを前提

この問題を解決するには、**Internal Lambda関数の新規作成**（上記「必須の修正事項1」）が最優先です。

### 3. その他の改善提案（範囲外）

以下は統括責務の動作には直接影響しないが、改善が望ましい点です:
- `getInvoice`関数が技術実装詳細に記載されていない（実装済みだが、統括責務からの呼び出しは想定されていない）
- `createCheckoutSession`関数が技術実装詳細に記載されていない（ユーザ向けAPIとして実装済み）
- CDKでのEventBridge ARN生成が不正確（`this.node.addr`ではなく、正しいリージョン/アカウントIDを使用すべき）

### 4. ファイル構成の評価

実装ファイルは適切に構造化されています:
- `verification/`: レシート検証ロジック
- `operations/`: 決済操作（作成、変更、キャンセル）
- `webhook/`: Webhookエンドポイント（Stripe、Apple、Google）
- `repositories/`: DynamoDBアクセスレイヤー
- `utils/`: ユーティリティ（署名検証、重複チェック、プラットフォーム判定）
- `types/`: 型定義

この構造は保守性が高く、拡張も容易です。

## 結論

Payment Gateway責務は**ほぼ実装済み**ですが、統括責務が動作するためには、**Internal Lambda関数の新規作成**が必須です。その他、パラメータ名の統一、Apple JWS署名検証の完全実装、Google認証の明確化が必要です。

これらの修正が完了すれば、統括責務は技術実装詳細に記載された通りに`paymentGatewayClient`を通じてPayment Gateway関数を呼び出すことができます。
