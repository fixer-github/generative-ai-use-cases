# EventBridge実装調査結果

**調査日**: 2025-11-13
**調査対象**: Payment Gateway WebhookからEventBridgeへのイベント配信実装

---

## 1. イベントバス

### 実装状況: **実装済み（デフォルトバス使用）**

#### コード確認箇所

**BillingManagementStack** (`packages/cdk/lib/stacks/nested/billing-management-stack.ts`)
- Line 43-46: `eventBusName` プロパティ定義（オプショナル、デフォルト値は `'default'`）
- Line 176: Payment Gateway構築時に `eventBusName` を渡している

```typescript
const paymentGatewayApi = new PaymentGatewayApi(
  this,
  'PaymentGateway',
  {
    api: billingApi,
    userPool: props.userPool,
    eventBusName: props.eventBusName,  // デフォルト: 'default'
  }
);
```

**PaymentGatewayApi** (`packages/cdk/lib/construct/api/payment-gateway.ts`)
- Line 26-29: `eventBusName` プロパティ定義（オプショナル、デフォルト値は `'default'`）
- Line 42: `eventBusName = 'default'` として受け取り
- Line 65: Webhook LambdaにEventBusNameを環境変数として設定

```typescript
environment: {
  EVENT_BUS_NAME: eventBusName,
}
```

**GenerativeAiUseCasesStack** (`packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`)
- Line 281-292: BillingManagementStackをインスタンス化
- **重要**: `eventBusName` パラメータが渡されていない → デフォルトの `'default'` バスを使用

#### テナント専用EventBus

**TenantPaymentGatewayStack** (`packages/cdk/lib/stacks/tenant/tenant-payment-gateway-stack.ts`)
- Line 22: `eventBusName` プロパティ定義
- Line 117-123: EventBus作成ロジック

```typescript
const eventBusName = props?.eventBusName || 'default';
this.eventBus =
  eventBusName === 'default'
    ? events.EventBus.fromEventBusName(this, 'EventBus', 'default')
    : new events.EventBus(this, 'TenantEventBus', {
        eventBusName: `${tenantId}-payment-gateway-events`,
      });
```

- **条件分岐**: `eventBusName` が `'default'` の場合は既存のデフォルトバスを使用、それ以外の場合はテナント専用バスを作成

#### 結論

- **現在の実装**: デフォルトEventBus (`'default'`) を使用している
- **テナント専用バス対応**: 実装自体は存在するが、現在のスタック構成では使用されていない
- **統括責務への影響**: デフォルトバスを使用しているため、**EventBridgeルールの作成時にバス名を明示的に指定する必要がある**

---

## 2. イベント形式

### 現在の形式: **統括責務が期待する形式と完全一致**

#### 実装確認箇所

**receiveWebhook.ts** (`packages/cdk/lambda/billing/payment-gateway/webhook/stripe/receiveWebhook.ts`)

Line 147-159: ビジネスイベントマッピング
```typescript
const businessEventType = mapStripeEventToBusinessEvent(eventType);

if (!businessEventType) {
  console.log(
    `Event type ${eventType} is not mapped to business event. Skipping EventBridge send.`
  );
  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, skipped: true }),
  };
}
```

Line 166-179: イベント詳細情報の抽出
```typescript
let eventDetail;
try {
  eventDetail = await extractEventDetail(stripeEvent, tenantId);
} catch (error) {
  console.error('Failed to extract event details:', error);
  return {
    statusCode: 200,
    body: JSON.stringify({
      received: true,
      error: 'Failed to extract event details',
    }),
  };
}
```

Line 181-195: EventBridge送信（正規化された形式）
```typescript
const putEventsCommand = new PutEventsCommand({
  Entries: [
    {
      Source: 'billing.payment-gateway',
      DetailType: businessEventType,
      Detail: JSON.stringify(eventDetail),
      EventBusName: eventBusName,
    },
  ],
});

await eventBridgeClient.send(putEventsCommand);
```

#### イベントマッピング実装

**eventMapper.ts** (`packages/cdk/lambda/billing/payment-gateway/webhook/stripe/eventMapper.ts`)

```typescript
const STRIPE_TO_BUSINESS_EVENT_MAP: Record<string, BusinessEventType> = {
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.paid': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
  'customer.subscription.deleted': 'subscription.canceled',
  'charge.refunded': 'payment.refunded',
};
```

#### イベント詳細抽出実装

**eventExtractor.ts** (`packages/cdk/lambda/billing/payment-gateway/webhook/stripe/eventExtractor.ts`)

抽出される情報:
- `platform`: 'stripe'
- `tenantId`: リクエストパスから取得
- `eventId`: Stripeイベントオブジェクトの `id`
- `originalEventType`: Stripeイベントタイプ（例: `invoice.payment_succeeded`）
- `subscriptionId`: Invoice/Subscriptionオブジェクトから抽出（必須）
- `userId`: Metadataから抽出（必須）
- `planId`: Price IDから抽出（オプショナル）
- `expirationDate`: Invoice Lineの `period.end` から算出（ISO 8601形式）
- `amount`: Invoice金額
- `currency`: 通貨コード
- `platformPaymentId`: Payment Intent ID
- `eventData`: 生のStripeイベントデータ

#### ビジネスイベント型定義

**businessEvent.ts** (`packages/cdk/lambda/billing/payment-gateway/types/businessEvent.ts`)

```typescript
export type BusinessEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.canceled'
  | 'payment.refunded';

export interface EventDetail {
  platform: 'stripe' | 'apple' | 'google';
  tenantId: string;
  eventId: string;
  originalEventType: string;
  subscriptionId: string;
  userId: string;
  planId?: string;
  expirationDate?: string;
  amount?: number;
  currency?: string;
  platformPaymentId?: string;
  errorMessage?: string;
  eventData: Record<string, any>;
}
```

### 統括責務が期待する形式との整合性: **完全一致**

#### EventBridgeイベント構造

**現在の実装が送信する形式**:
```json
{
  "Source": "billing.payment-gateway",
  "DetailType": "payment.succeeded | payment.failed | subscription.canceled | payment.refunded",
  "Detail": {
    "platform": "stripe",
    "tenantId": "tenant-abc123",
    "eventId": "evt_1ABC2DEF3GHI",
    "originalEventType": "invoice.payment_succeeded",
    "subscriptionId": "sub_1XYZ2ABC3DEF",
    "userId": "user-123456",
    "planId": "plan_standard_monthly",
    "expirationDate": "2025-12-13T10:30:00Z",
    "amount": 1980,
    "currency": "jpy",
    "platformPaymentId": "pi_1ABC2DEF3GHI",
    "eventData": { /* 生イベント */ }
  }
}
```

**統括責務が期待する形式** (`docs/課金・プランの仕様/購入・変更・解約などの複数ステップの処理を統括する/統括責務が必要とするイベント形式定義.md`):
```typescript
interface OrchestratorWebhookEvent {
  source: 'billing.payment-gateway';  // ✅ 一致
  'detail-type': BusinessEventType;   // ✅ 一致
  detail: EventDetail;                // ✅ 一致
}
```

#### 差異: **なし**

現在の実装は、統括責務が期待する形式と完全に一致しています。

---

## 3. EventBridgeルール

### 実装状況: **未実装**

#### 調査結果

CDKコード内でEventBridgeルールの定義は見つかりませんでした。

- `packages/cdk/lib/` 配下で `events.Rule` または `EventPattern` を検索
- 結果: Authorization System内のスケジュールルール（日次/月次リセット）のみ存在
- **統括責務が必要とするWebhookイベント用のルールは未作成**

#### 必要なルール

統括責務が処理すべき4つのイベントタイプ:

1. `payment.succeeded`
2. `payment.failed`
3. `subscription.canceled`
4. `payment.refunded`

これらのイベントごとにEventBridgeルールを作成し、統括責務のLambda関数をターゲットとして設定する必要があります。

---

## 4. 統括責務実装のための必須修正事項まとめ

### 修正不要な項目（既に実装済み）

- ✅ **イベントバス**: デフォルトバス使用中（問題なし）
- ✅ **イベント形式**: 統括責務が期待する形式と完全一致
- ✅ **ビジネスイベントマッピング**: Stripe → ビジネスイベント変換実装済み
- ✅ **情報抽出ロジック**: `subscriptionId`, `userId` 等の必須情報抽出実装済み
- ✅ **EventBridge送信**: 正規化された形式でPutEvents実行済み

### 必須修正事項

#### 修正5-1: EventBridgeルールの作成

**概要**: 統括責務のWebhookイベントハンドラーLambda関数を起動するためのEventBridgeルールを作成

**実装場所**:
- 統括責務用の新規Construct（例: `OrchestrationService`）
- または、既存の `BillingManagementStack` に追加

**必要なルール定義**:

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// 統括責務Lambda関数（後で実装）
const orchestratorWebhookHandler: NodejsFunction = ...;

// ルール1: payment.succeeded
const paymentSucceededRule = new events.Rule(this, 'PaymentSucceededRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'EventBus', 'default'),
  eventPattern: {
    source: ['billing.payment-gateway'],
    detailType: ['payment.succeeded'],
  },
  description: 'Route payment.succeeded events to orchestrator',
});
paymentSucceededRule.addTarget(new targets.LambdaFunction(orchestratorWebhookHandler));

// ルール2: payment.failed
const paymentFailedRule = new events.Rule(this, 'PaymentFailedRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'EventBus', 'default'),
  eventPattern: {
    source: ['billing.payment-gateway'],
    detailType: ['payment.failed'],
  },
  description: 'Route payment.failed events to orchestrator',
});
paymentFailedRule.addTarget(new targets.LambdaFunction(orchestratorWebhookHandler));

// ルール3: subscription.canceled
const subscriptionCanceledRule = new events.Rule(this, 'SubscriptionCanceledRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'EventBus', 'default'),
  eventPattern: {
    source: ['billing.payment-gateway'],
    detailType: ['subscription.canceled'],
  },
  description: 'Route subscription.canceled events to orchestrator',
});
subscriptionCanceledRule.addTarget(new targets.LambdaFunction(orchestratorWebhookHandler));

// ルール4: payment.refunded
const paymentRefundedRule = new events.Rule(this, 'PaymentRefundedRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'EventBus', 'default'),
  eventPattern: {
    source: ['billing.payment-gateway'],
    detailType: ['payment.refunded'],
  },
  description: 'Route payment.refunded events to orchestrator',
});
paymentRefundedRule.addTarget(new targets.LambdaFunction(orchestratorWebhookHandler));
```

**代替案（単一ルールで全イベント処理）**:

```typescript
const allWebhookEventsRule = new events.Rule(this, 'AllWebhookEventsRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'EventBus', 'default'),
  eventPattern: {
    source: ['billing.payment-gateway'],
    detailType: [
      'payment.succeeded',
      'payment.failed',
      'subscription.canceled',
      'payment.refunded',
    ],
  },
  description: 'Route all payment webhook events to orchestrator',
});
allWebhookEventsRule.addTarget(new targets.LambdaFunction(orchestratorWebhookHandler));
```

**推奨**: 単一ルールで全イベントを処理し、Lambda関数内で `detail-type` に応じて処理を分岐する方が管理しやすい。

#### 修正5-2: 統括責務Lambda関数へのEventBridge実行権限付与

**概要**: EventBridgeがLambda関数を起動できるようにIAM権限を付与

**実装**: EventBridgeルールに `.addTarget()` を使用すると自動的に権限が付与されるため、追加のIAM設定は不要。

---

## 5. 追加調査事項

### Apple/Google Webhook実装状況

**調査結果**: Stripe以外のプラットフォームのWebhook実装も確認済み

- `packages/cdk/lambda/billing/payment-gateway/webhook/apple/receiveNotification.ts`
- `packages/cdk/lambda/billing/payment-gateway/webhook/google/receiveNotification.ts`

両ファイルとも、Stripeと同様に:
- EventBridgeClientを使用
- `EVENT_BUS_NAME` 環境変数を取得
- `PutEvents` でイベント送信

**結論**: 3プラットフォーム全てでEventBridge連携が実装されています。

---

## 6. 実装優先順位

統括責務の実装を開始するために、以下の順序で作業を進めることを推奨します:

### Phase 1: EventBridgeルール作成（必須）
- [ ] 統括責務のWebhookハンドラーLambda関数を作成（空実装でOK）
- [ ] EventBridgeルール4つ（またはまとめて1つ）を作成
- [ ] ルールとLambda関数を接続
- [ ] デプロイ後、Stripe Test Webhookでイベントがルーティングされることを確認

### Phase 2: 統括責務ハンドラー実装
- [ ] Lambda関数内で `detail-type` による分岐処理を実装
- [ ] 各イベントタイプごとの処理ロジックを実装
  - `payment.succeeded`: サブスクリプション有効期限延長
  - `payment.failed`: サブスクリプション状態を `past_due` に変更
  - `subscription.canceled`: サブスクリプションキャンセル・権限剥奪
  - `payment.refunded`: 返金処理・権限剥奪

### Phase 3: エラーハンドリングと冪等性担保
- [ ] DynamoDBでのイベント処理状態管理（重複処理防止）
- [ ] リトライ処理とデッドレターキューの設定
- [ ] CloudWatch Alarmsの設定（処理失敗時の通知）

---

## 7. 結論

### 現状評価

Payment Gateway Webhookの実装は**非常に高品質**であり、統括責務が期待する形式と完全に一致しています。

- ✅ イベントバス: デフォルトバス使用（問題なし）
- ✅ イベント形式: 統括責務仕様と完全一致
- ✅ マッピング・抽出: 必須情報が正しく取得されている
- ⚠️ EventBridgeルール: **未実装（唯一の不足項目）**

### 次のアクション

**統括責務実装に向けて、EventBridgeルールを作成するだけで実装を開始できます。**

イベント形式の変更やWebhook受信処理の修正は一切不要です。
