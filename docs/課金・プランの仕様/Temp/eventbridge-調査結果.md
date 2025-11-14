# EventBridge設定 調査結果

## 調査概要
- 調査対象ディレクトリ: `packages/cdk/lib/construct/`, `packages/cdk/lib/stacks/`
- 調査対象ファイル数: 約90ファイル
- 調査日時: 2025-11-14
- 調査範囲: EventBridge関連のConstruct、ルール、DLQの実装状況

## イベントバス
### 実装状況: 部分的に実装済み
### 定義場所:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/tenant/tenant-payment-gateway-stack.ts` (116-123行目)
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/payment-gateway.ts` (26-29行目、42行目、65行目、81行目、98行目、206行目)

### 実装されている内容:
```typescript
// tenant-payment-gateway-stack.ts (116-123行目)
const eventBusName = props?.eventBusName || 'default';
this.eventBus =
  eventBusName === 'default'
    ? events.EventBus.fromEventBusName(this, 'EventBus', 'default')
    : new events.EventBus(this, 'TenantEventBus', {
        eventBusName: `${tenantId}-payment-gateway-events`,
      });
```

```typescript
// payment-gateway.ts (42行目)
const { api, userPool, eventBusName = 'default' } = props;
```

### 問題点:
1. **カスタムイベントバスが作成されていない**: デフォルトの'default'イベントバスを使用している。技術実装詳細.mdではカスタムイベントバス（または既存のeventBusNameパラメータ）を期待しているが、実際には'default'がデフォルト値となっている
2. **統括責務用のイベントバス設定が未定義**: billing-management-stack.tsではeventBusNameをpayment-gateway.tsに渡しているが、統括責務（orchestration）用のイベントバス設定は存在しない
3. **イベントソースの不一致**: 技術実装詳細.mdでは`billing.payment-gateway`をソースとして期待しているが、実装確認できず

## EventBridgeルール
### Stripe Webhook用ルール
#### 実装状況: 未実装
#### イベントパターン: 実装なし
#### ターゲット: 実装なし

### Apple Webhook用ルール
#### 実装状況: 未実装
#### イベントパターン: 実装なし
#### ターゲット: 実装なし

### Google Webhook用ルール
#### 実装状況: 未実装
#### イベントパターン: 実装なし
#### ターゲット: 実装なし

### 調査詳細:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/payment-gateway.ts`にWebhook受信用のLambda関数は定義されている（55-102行目）
  - `receiveStripeWebhookFunction`
  - `receiveAppleNotificationFunction`
  - `receiveGoogleNotificationFunction`
- これらのLambda関数には`EVENT_BUS_NAME`環境変数が設定されている（65行目、81行目、98行目）
- しかし、**EventBridgeルールの定義が存在しない**
- Webhook Lambda関数には`events:PutEvents`権限が付与されている（201-209行目）が、これはLambda関数からEventBridgeにイベントを送信するための権限であり、EventBridgeからLambda関数を起動するルールではない

## デッドレターキュー（DLQ）
### 実装状況: 未実装
### 定義場所: 実装なし
### リトライ設定: 実装なし

### 問題点:
- SQSキュー `${environment}-webhook-event-dlq` の定義が存在しない
- EventBridgeルール自体が未実装のため、DLQの設定も存在しない
- 技術実装詳細.mdで期待されている以下の設定が全て未実装:
  - キュー名: `${environment}-webhook-event-dlq`
  - メッセージ保持期間: 14日間
  - リトライ設定: 最大3回、指数バックオフ

## 統括責務（Orchestration）の実装状況
### 実装状況: 未実装
### 問題点:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/orchestration.ts` が存在しない
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/orchestration/` ディレクトリが存在しない
- billing-management-stack.tsの205-206行目にコメントで「Orchestration API (統括処理) will be added later as needed」と記載されているのみ

## 統括責務が動作する上で必須の修正事項

### 1. EventBridgeルールの作成（最重要）
統括責務のWebhookイベント処理フロー統括Lambda関数を起動するために、以下の3つのEventBridgeルールが必須:

#### Stripe Webhook用ルール
- ルール名: `${environment}-stripe-webhook-to-orchestration`
- イベントパターン:
  ```json
  {
    "source": ["billing.payment-gateway"],
    "detail-type": ["Stripe Webhook Event"],
    "detail": {
      "platform": ["stripe"]
    }
  }
  ```
- ターゲット: Webhookイベント処理フロー統括Lambda関数（未実装）

#### Apple Webhook用ルール
- ルール名: `${environment}-apple-webhook-to-orchestration`
- イベントパターン:
  ```json
  {
    "source": ["billing.payment-gateway"],
    "detail-type": ["Apple Webhook Event"],
    "detail": {
      "platform": ["apple"]
    }
  }
  ```
- ターゲット: Webhookイベント処理フロー統括Lambda関数（未実装）

#### Google Webhook用ルール
- ルール名: `${environment}-google-webhook-to-orchestration`
- イベントパターン:
  ```json
  {
    "source": ["billing.payment-gateway"],
    "detail-type": ["Google Webhook Event"],
    "detail": {
      "platform": ["google"]
    }
  }
  ```
- ターゲット: Webhookイベント処理フロー統括Lambda関数（未実装）

### 2. デッドレターキュー（DLQ）の作成
- キュー名: `${environment}-webhook-event-dlq`
- メッセージ保持期間: 14日間（1,209,600秒）
- 可視性タイムアウト: 30秒
- 役割: 最大リトライ回数を超えたWebhookイベントを保持

### 3. EventBridgeターゲット設定のリトライポリシー
各EventBridgeルールのターゲット設定に以下を追加:
- 最大リトライ回数: 3回
- デッドレターキュー: 上記で作成したSQSキュー
- リトライポリシー: 指数バックオフ（基数2秒）

### 4. OrchestrationConstructの作成
- ファイルパス: `packages/cdk/lib/construct/api/orchestration.ts`
- 役割: EventBridgeルール、DLQ、Webhookイベント処理フロー統括Lambda関数を定義
- BillingManagementStackへの統合が必要

### 5. Webhookイベント処理フロー統括Lambda関数の作成
- ファイルパス: `packages/cdk/lambda/billing/orchestration/flows/webhookEventFlow.ts`
- EventBridgeルールからトリガーされる
- イベントタイプ（payment.succeeded、payment.failed、subscription.canceled、refund.createdなど）に応じた処理分岐を実装

## 補足事項

### 既存の実装で正しく動作している部分:
1. **Webhook受信Lambda関数**: payment-gateway.tsで定義されており、EventBridgeへのイベント送信権限も付与されている
2. **EventBusの参照**: tenant-payment-gateway-stack.tsでEventBusの参照が実装されている（デフォルトバスまたはカスタムバス）
3. **環境変数の設定**: Webhook受信Lambda関数に`EVENT_BUS_NAME`環境変数が設定されている

### 現在の処理フロー（推測）:
1. Stripe/Apple/GoogleからWebhook通知を受信
2. payment-gateway.tsのLambda関数（receiveStripeWebhookFunction等）が署名検証を実施
3. 検証成功後、EventBridgeにイベントを送信（`events:PutEvents`権限を利用）
4. **この後の処理が未実装**: EventBridgeルールが存在しないため、イベントは配信されない
5. 統括責務のLambda関数が起動されるべきだが、実装されていない

### 実装の優先順位:
1. **最優先**: OrchestrationConstructとWebhookイベント処理フロー統括Lambda関数の作成
2. **必須**: EventBridgeルール3つの定義
3. **必須**: DLQの作成とリトライポリシーの設定
4. **推奨**: カスタムイベントバスの作成（現在はdefaultバスを使用）

### アーキテクチャ上の注意点:
- 技術実装詳細.mdではEventBridgeルールは「OrchestrationConstruct内で定義」することが想定されている（465-514行目参照）
- しかし、OrchestrationConstruct自体が未実装のため、EventBridgeルールも未実装
- billing-management-stack.tsへのOrchestrationConstructの統合も必要（569-587行目参照）
