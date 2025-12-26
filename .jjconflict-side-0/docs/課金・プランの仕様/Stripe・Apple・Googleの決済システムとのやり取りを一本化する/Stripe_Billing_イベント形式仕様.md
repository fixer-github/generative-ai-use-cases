# Stripe Billing イベント形式調査結果

**作成日**: 2025-11-13 16:10 (UTC+09:00)  
**対象 API バージョン**: `2025-10-29.clover`  
**対象 SDK**: stripe-node `^19.3.0`

---

## 1. エグゼクティブサマリー

- **成功支払いの基準は `invoice.paid` を第一候補に**（請求書が「支払い済み」になった確定イベント。銀行振込や「手動で支払い済みにする」を含む）。カードの自動課金のみで十分なら `invoice.payment_succeeded` でも可。
- **失敗は `invoice.payment_failed`** を基準に扱い、詳細理由は **PaymentIntent の `last_payment_error`** を参照。自動再試行（Smart Retries）が有効な場合は **「失敗→再試行予定」** の状態管理が必要。
- **キャンセルは `customer.subscription.deleted`**。`cancel_at_period_end` と **`cancellation_details`**（即時/期末・理由）で区別可能。
- **返金は `charge.refunded`** を基準に。`amount_refunded` で **部分/全額** を判定。`charge.invoice` でインボイス（=サブスクリプションの課金）にトレース可。
- **メタデータ伝播の要点**：Checkout（`mode: 'subscription'`）では **`subscription_data.metadata`** に `userId`/`tenantId` を設定。これが **請求書の `parent.subscription_details.metadata`** にスナップショットされ、Webhook 側で安定取得可能。
- **Clover バージョンの重要差分**：
  - Invoice の **`payment_intent` 直下フィールドは廃止**。代わりに **Invoice Payments** API か **`invoice.payments`**（インクルーダブル）で紐付けを取得。
  - Invoice Line の `price` は **`lines.data[].pricing.price_details.price`** へ移動。
  - Subscription の `current_period_start/end` は **SubscriptionItem レベルに移行**（有効期限などは **Invoice Line の `period.end`** を利用するのが実務的に安定）。
- **順序と再送**：Webhook は**順序保証なし**。**最大3日間リトライ**。**冪等処理・最新状態の再取得**が前提。

---

## 2. イベントタイプ → ビジネスイベント マッピング（推奨）

> 目的：オーケストレーター（統括責務）がプラットフォーム非依存で扱える 4 種のビジネスイベントに正規化。

| Stripeイベントタイプ                              | ビジネスイベント           | 主な発火トリガー                                               | 優先度     | 備考                                                        |
| ------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `invoice.paid`                                    | `payment.succeeded`        | 請求書が支払い済みに遷移（自動課金・銀行振込・手動マーク含む） | **最優先** | 成功判定の網羅性が最も高い                                  |
| `invoice.payment_succeeded`                       | `payment.succeeded`        | 自動課金が成功（カード等）                                     | 高         | ToC カード決済のみなら実運用で十分                          |
| `invoice.payment_failed`                          | `payment.failed`           | 自動課金の試行が失敗                                           | **最優先** | 再試行予定は PI の状態と Smart Retries を参照               |
| `customer.subscription.deleted`                   | `subscription.canceled`    | 明示キャンセル／期限終了キャンセル／滞納によるキャンセル等     | **最優先** | `cancel_at_period_end` や `cancellation_details` で種別判定 |
| `charge.refunded`                                 | `payment.refunded`         | チャージの返金（全額/部分）                                    | **最優先** | `amount_refunded` と `charge.invoice` で判定・トレース      |
| （参考）`refund.updated`                          | `payment.refunded`（補助） | 返金の状態更新（非同期PM等）                                   | 中         | 非同期メソッド利用時の補助イベント                          |
| （対象外）`customer.subscription.updated`         | ー                         | 期日更新・数量変更等の多目的更新                               | 対象外     | 正規化イベントのノイズ源になりやすい                        |
| （対象外）`invoice.created` / `invoice.finalized` | ー                         | インボイス生成/確定                                            | 対象外     | 内部状態の変化であり最終的な結果ではない                    |

---

## 3. 重要 4 イベントの詳細ガイド

> サンプルは `2025-10-29.clover` を前提に、実運用でよく使うフィールドを最小構成で例示しています（実際のペイロードはさらに多くの属性を含みます）。

### 3.1 `invoice.payment_succeeded`（または `invoice.paid`）

#### 3.1.1 サンプル（要点抜粋）

```json
{
  "id": "evt_123",
  "type": "invoice.payment_succeeded",
  "data": {
    "object": {
      "id": "in_abc",
      "object": "invoice",
      "status": "paid",
      "currency": "jpy",
      "amount_paid": 1200,
      "total": 1200,
      "customer": "cus_123",
      "lines": {
        "data": [
          {
            "id": "il_1",
            "object": "line_item",
            "period": { "start": 1761993600, "end": 1764585599 },
            "pricing": {
              "price_details": { "price": "price_789" }
            },
            "parent": {
              "subscription_item_details": {
                "subscription": "sub_456",
                "subscription_item": "si_999"
              }
            }
          }
        ]
      },
      "parent": {
        "subscription_details": {
          "subscription": "sub_456",
          "metadata": { "userId": "u_001", "tenantId": "t_001" }
        }
      },
      "payments": {
        "data": [{ "payment_intent": "pi_987", "status": "succeeded" }]
      }
    }
  }
}
```

#### 3.1.2 情報抽出パス（推奨）

```ts
// event は Stripe.WebhookEndpointEvent（受信Webhook）
const inv = event.data.object as Stripe.Invoice;

const subscriptionId =
  inv.parent?.subscription_details?.subscription ??
  inv.lines.data[0]?.parent?.subscription_item_details?.subscription; // フォールバック

const userId =
  inv.parent?.subscription_details?.metadata?.userId ??
  inv.metadata?.userId; /* 運用で設定している場合のみ */
// 最後の手段：Customer API で取得
// await stripe.customers.retrieve(inv.customer as string).then(c => c.metadata?.userId);

const tenantId =
  inv.parent?.subscription_details?.metadata?.tenantId ??
  inv.metadata?.tenantId; /* 運用依存 */

const planId = inv.lines.data[0]?.pricing?.price_details?.price;

const expirationDate = new Date(
  (inv.lines.data[0]?.period?.end ?? 0) * 1000
).toISOString();

const amount = inv.amount_paid ?? inv.total; // 「実際に回収した金額」優先
const currency = inv.currency;

// Clover では Invoice.payment_intent は廃止。Invoice Payments を利用
const platformPaymentId =
  inv.payments?.data?.find((p) => p.status === 'succeeded')?.payment_intent ??
  // ない場合は /v1/invoices/{id}/payments で取得
  // await stripe.invoices.listPayments(inv.id).then(r => r.data[0]?.payment_intent)
  inv.id; // 最低限の相関キーとして Invoice ID を保持
```

#### 3.1.3 補足

- 価格IDは **`lines.data[].pricing.price_details.price`**。旧 `line.price` ではありません。
- サブスク有効期限は **Invoice Line の `period.end`** を採用（`current_period_end` は SubscriptionItem 側へ移行済み）。
- `invoice.paid` を使う場合も抽出パスは同様です。

---

### 3.2 `invoice.payment_failed`

#### 3.2.1 サンプル（要点抜粋）

```json
{
  "id": "evt_124",
  "type": "invoice.payment_failed",
  "data": {
    "object": {
      "id": "in_def",
      "object": "invoice",
      "status": "open",
      "currency": "jpy",
      "amount_due": 1200,
      "customer": "cus_123",
      "parent": {
        "subscription_details": {
          "subscription": "sub_456",
          "metadata": { "userId": "u_001", "tenantId": "t_001" }
        }
      },
      "attempt_count": 1,
      "next_payment_attempt": 1762080000,
      "payments": {
        "data": [
          { "payment_intent": "pi_654", "status": "requires_payment_method" }
        ]
      }
    }
  }
}
```

#### 3.2.2 情報抽出パス（推奨）

```ts
const inv = event.data.object as Stripe.Invoice;
const subscriptionId = inv.parent?.subscription_details?.subscription;
const userId = inv.parent?.subscription_details?.metadata?.userId;
const tenantId = inv.parent?.subscription_details?.metadata?.tenantId;

// 失敗理由は PaymentIntent を参照
const failedPiId = inv.payments?.data?.[0]?.payment_intent;
// ない場合は listPayments, さらに無ければ events から PI をトレース
let errorMessage: string | undefined;
if (failedPiId) {
  const pi = await stripe.paymentIntents.retrieve(failedPiId);
  errorMessage = pi.last_payment_error?.message ?? pi.last_payment_error?.code;
}

// dunning/再試行のヒント
const retryCount = inv.attempt_count;
const nextRetryAt = inv.next_payment_attempt
  ? new Date(inv.next_payment_attempt * 1000).toISOString()
  : undefined;

// 状態：sub の status で past_due 等を確認（必要なら API で取得）
```

#### 3.2.3 補足

- 自動再試行（Smart Retries）有効時は **「支払い失敗」=最終失敗** ではありません。**次回試行予定**を持って「保留」扱いとし、最終的な失敗確定ロジックを別途定義してください。
- 実装上は **再入荷（重送）や順不同**を前提に **冪等化 + 最新状態の再取得** がベストプラクティスです。

---

### 3.3 `customer.subscription.deleted`

#### 3.3.1 サンプル（要点抜粋）

```json
{
  "id": "evt_125",
  "type": "customer.subscription.deleted",
  "data": {
    "object": {
      "id": "sub_456",
      "object": "subscription",
      "status": "canceled",
      "cancel_at_period_end": false,
      "canceled_at": 1761993600,
      "cancellation_details": {
        "reason": "cancellation_requested"
      },
      "metadata": { "userId": "u_001", "tenantId": "t_001" },
      "items": {
        "data": [{ "id": "si_999", "price": "price_789" }]
      }
    }
  }
}
```

#### 3.3.2 情報抽出パス

```ts
const sub = event.data.object as Stripe.Subscription;

const subscriptionId = sub.id;
const userId =
  sub.metadata
    ?.userId; /* Checkout で subscription_data.metadata を設定しておくこと */
const tenantId = sub.metadata?.tenantId;
const planId = sub.items.data[0]?.price as string; // もしくは items.data[0].price.id（SDK の型に準拠）

// 種別判定
const isCancelAtPeriodEnd = sub.cancel_at_period_end === true;
const reason = sub.cancellation_details?.reason; // "payment_failed" 等
```

#### 3.3.3 補足（トリガー）

- ユーザーの明示キャンセル、管理者によるキャンセル、**支払い失敗の最終化** などで発火。
- **即時キャンセル/期末キャンセル** は `cancel_at_period_end` と `cancellation_details` を併用して区別可能。

---

### 3.4 `charge.refunded`

#### 3.4.1 サンプル（要点抜粋）

```json
{
  "id": "evt_126",
  "type": "charge.refunded",
  "data": {
    "object": {
      "id": "ch_abc",
      "object": "charge",
      "amount": 1200,
      "amount_refunded": 800,
      "currency": "jpy",
      "paid": true,
      "refunded": false,
      "invoice": "in_abc",
      "payment_intent": "pi_987",
      "metadata": {}
    }
  }
}
```

#### 3.4.2 情報抽出パス

```ts
const ch = event.data.object as Stripe.Charge;

const invoiceId = ch.invoice as string | undefined; // サブスク請求と結び付け
const subscriptionId = invoiceId
  ? /* await stripe.invoices.retrieve(invoiceId) */ undefined
  : undefined; // 必要に応じて Invoice → subscription にトレース

const userId = ch.metadata?.userId; /* 支払い起点で付与していれば */

// 返金金額と種別
const amount = ch.amount_refunded;
const currency = ch.currency;
const isFullRefund = ch.amount_refunded === ch.amount;

// プラットフォーム側の決済キー
const platformPaymentId = ch.id; // 決済(Charge) ID
```

#### 3.4.3 補足

- **部分返金/全額返金** は `amount_refunded` と `amount` の比較で判定。
- サブスクへの紐付けは **`charge.invoice` → Invoice → (parent.subscription_details)** で逆引き可能。

---

## 4. メタデータ伝播と取得戦略

### 4.1 Checkout（`mode: 'subscription'`）での推奨設定

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: userInfo.email,
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: successUrl,
  cancel_url: cancelUrl,

  // ★ ここが重要：サブスクリプションにメタデータを持たせる
  subscription_data: {
    metadata: { userId, tenantId },
  },

  // （任意）顧客にメタデータを残したい場合は、checkout.session.completed 後に
  // stripe.customers.update(customerId, { metadata: { userId, tenantId } })
});
```

### 4.2 Webhook での安定取得ポイント

- **Invoice**：`parent.subscription_details.metadata`（スナップショット）
- **Subscription**：`metadata`（Checkout の `subscription_data.metadata` 由来）
- **Charge/Refund**：Checkout 経由のサブスク課金では PI/Charge の metadata 伝播は限定的。**Invoice 経由で逆引き**するのが堅実。単発決済（`mode: 'payment'`）では `payment_intent_data.metadata` → Charge に伝播。

---

## 5. Clover（`2025-10-29.clover`）での注意点

- **Invoice と支払いの紐付け**：`invoice.payment_intent` は **削除**。**Invoice Payments API**（`/v1/invoices/{id}/payments`）か **`invoice.payments`（インクルーダブル）** を使用。
- **価格参照**：`lines.data[].pricing.price_details.price` に変更（旧 `line.price` ではない）。
- **期間属性**：`current_period_start/end` は SubscriptionItem へ。**請求期間の上限**として **Invoice Line の `period.end`** を利用。
- **請求モード**の初期値が Flexible（柔軟な請求）に変更（プロレータやスケジュールの扱いに影響）。

---

## 6. 実装時ベストプラクティス

1. **冪等性**：イベント ID で重複排除（現実装 OK）。書き込み系 API 呼び出しは `Idempotency-Key` を付与。
2. **最新状態の再取得**：Webhook ペイロードだけに依存せず、必要に応じ **Invoice / PaymentIntent / Subscription** を API で再取得。
3. **順不同/遅延に耐える状態機械**：
   - `payment_failed` 受信時に **最終失敗確定**とせず、再試行完了かキャンセル確定を待つ。
   - `subscription.deleted` と `invoice.payment_succeeded` の前後が入れ替わっても破綻しないよう、**最終状態を決定する優先順位**を定義。
4. **イベント→ビジネスイベントの正規化層**：
   - 受信イベント（Stripe固有）を **即時正規化**して EventBridge へ（プラットフォーム非依存スキーマ）。
   - 推奨スキーマ例：
     ```json
     {
       "type": "payment.succeeded|payment.failed|payment.refunded|subscription.canceled",
       "platform": "stripe",
       "platformEventId": "evt_xxx",
       "occurredAt": "<ISO-8601>",
       "tenantId": "t_001",
       "userId": "u_001",
       "subscriptionId": "sub_...",
       "planId": "price_...",
       "expirationDate": "<ISO-8601>",
       "amount": 1200,
       "currency": "jpy",
       "platformPaymentId": "pi_...|ch_...|in_...",
       "raw": {}
     }
     ```
5. **テスト**：Stripe CLI の `listen` / `trigger` を活用。ユニットテストでは固定フィクスチャのほか、**API で実生成したオブジェクトを使う統合テスト**も用意。

---

## 7. 追加調査項目

### 7.1 Webhook イベントの順序

- **順序保証なし**。**常に最新状態を API で再確認**する設計に。

### 7.2 Webhook リトライポリシー

- 失敗時は **最大 3 日間** 自動リトライ（指数バックオフ）。最終的に未配信のイベントは **List Events** から補完可能。

### 7.3 テスト手順（例）

- `stripe listen --forward-to https://.../webhook/stripe`
- `stripe trigger invoice.payment_succeeded`
- `stripe trigger invoice.payment_failed`
- `stripe trigger customer.subscription.deleted`
- `stripe trigger charge.refunded`

---

## 8. 参照リンク（抜粋）

- イベントタイプ（`invoice.paid`/`payment_succeeded`/`payment_failed` などの定義）  
  https://docs.stripe.com/events/types

- Invoice オブジェクト（`lines.data[].period`、`parent.subscription_details`、`payments` ほか）  
  https://docs.stripe.com/api/invoices/object

- Invoice Payments（Invoice と支払いの対応付け）  
  https://docs.stripe.com/api/invoices/payments

- PaymentIntent（`last_payment_error` ほか）  
  https://docs.stripe.com/api/payment_intents/object

- Charge（`amount_refunded`、`invoice` リンク）  
  https://docs.stripe.com/api/charges/object

- Smart Retries（自動再試行の考え方）  
  https://docs.stripe.com/billing/subscriptions/overview#preventing-failed-payments

- Webhook（順序/再送/手動補完）  
  https://docs.stripe.com/webhooks  
  https://docs.stripe.com/webhooks/process-undelivered-events

- Checkout メタデータの扱い（`subscription_data.metadata` 推奨）  
  https://support.stripe.com/questions/using-metadata-with-checkout-sessions
