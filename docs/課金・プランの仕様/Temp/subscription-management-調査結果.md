# Subscription Management責務 Internal関数 調査結果

## 調査概要

**調査日時**: 2025-11-14
**調査対象ディレクトリ**: `packages/cdk/lambda/billing/subscription-management/internal/`
**調査したファイル数**: 4ファイル（TypeScript実装ファイル）
**期待されるInternal関数数**: 4関数

## createSubscription関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/subscription-management/internal/createSubscription.ts`

### シグネチャの一致度: **部分一致（軽微な差異あり）**

### 実装内容の詳細

**期待される入力パラメータ（技術実装詳細.md）**:
- tenantId
- userId
- planId
- platform
- platformSubscriptionId
- receiptData

**実際の実装の入力パラメータ**:
```typescript
export interface CreateSubscriptionInput {
  userId: string;
  planId: string;
  platformType: 'stripe' | 'apple' | 'google';
  platformSubscriptionId: string;
  subscriptionStatus: 'active' | 'pending_verification';
  currentPeriodStart: string; // ISO 8601
  currentPeriodEnd: string;   // ISO 8601
  tenantId: string;
}
```

**期待される出力パラメータ（技術実装詳細.md）**:
- subscriptionId

**実際の実装の出力パラメータ**:
```typescript
export interface CreateSubscriptionOutput {
  subscriptionId: string;
  status: 'active' | 'pending_verification';
}
```

### 問題点

1. **パラメータ名の不一致**:
   - 期待: `platform` → 実装: `platformType`
   - これは許容範囲の違いだが、統括責務からの呼び出し時にパラメータ名を正確に合わせる必要がある

2. **receiptDataパラメータの欠落**:
   - 技術実装詳細.mdでは`receiptData`が期待されているが、実装には存在しない
   - 代わりに`subscriptionStatus`、`currentPeriodStart`、`currentPeriodEnd`が追加されている
   - これは設計変更と思われる（レシート検証は統括責務側で実施し、検証済みの情報をこの関数に渡す方式）

3. **Lambda関数としての定義**: ✅ 正しく実装されている
   - CDKでLambda関数として定義されている（`subscription-management.ts`で確認済み）
   - 関数名: `${environment}-billing-subscription-internal-create`

### Lambda関数定義状況
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/subscription-management.ts` の143-152行目で定義済み:
```typescript
const createSubscriptionFunction = new NodejsFunction(
  this,
  'InternalCreateSubscription',
  {
    ...commonLambdaConfig,
    entry: './lambda/billing/subscription-management/internal/createSubscription.ts',
    functionName: `${environment}-billing-subscription-internal-create`,
  }
);
```

---

## updateSubscriptionStatus関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts`

### シグネチャの一致度: **部分一致（軽微な差異あり）**

### 実装内容の詳細

**期待される入力パラメータ（技術実装詳細.md）**:
- tenantId
- subscriptionId
- status
- statusReason

**実際の実装の入力パラメータ**:
```typescript
export interface UpdateSubscriptionStatusInput {
  subscriptionId: string;
  newStatus: 'active' | 'past_due' | 'canceled' | 'expired';
  tenantId: string;
}
```

**期待される出力パラメータ（技術実装詳細.md）**: （明示的な記載なし）

**実際の実装の出力パラメータ**:
```typescript
export interface UpdateSubscriptionStatusOutput {
  subscriptionId: string;
  previousStatus: string;
  newStatus: string;
  updatedAt: string;
}
```

### 問題点

1. **パラメータ名の不一致**:
   - 期待: `status` → 実装: `newStatus`
   - これは許容範囲の違いだが、統括責務からの呼び出し時にパラメータ名を正確に合わせる必要がある

2. **statusReasonパラメータの欠落**:
   - 技術実装詳細.mdでは`statusReason`が期待されているが、実装には存在しない
   - ステータス変更理由を記録できない

3. **Lambda関数としての定義**: ✅ 正しく実装されている
   - CDKでLambda関数として定義されている
   - 関数名: `${environment}-billing-subscription-internal-update-status`

### Lambda関数定義状況
`subscription-management.ts` の155-164行目で定義済み。

---

## getSubscription関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/subscription-management/internal/getSubscription.ts`

### シグネチャの一致度: **完全一致**

### 実装内容の詳細

**期待される入力パラメータ（技術実装詳細.md）**:
- tenantId
- subscriptionId

**実際の実装の入力パラメータ**:
```typescript
export interface GetSubscriptionInput {
  subscriptionId: string;
  tenantId: string;
}
```

**期待される出力パラメータ（技術実装詳細.md）**:
- サブスクリプション情報

**実際の実装の出力パラメータ**:
```typescript
export interface GetSubscriptionOutput {
  subscription: {
    subscriptionId: string;
    userId: string;
    planId: string;
    platformType: 'stripe' | 'apple' | 'google';
    platformSubscriptionId: string;
    subscriptionStatus: Subscription['subscription_status'];
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
```

### 問題点

**問題なし** - 期待通りに実装されている

### Lambda関数としての定義
✅ 正しく実装されている
- CDKでLambda関数として定義されている
- 関数名: `${environment}-billing-subscription-internal-get`

### Lambda関数定義状況
`subscription-management.ts` の167-176行目で定義済み。

---

## extendSubscriptionPeriod関数

### 実装状況: **実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts`

### シグネチャの一致度: **部分一致（パラメータ名の違い）**

### 実装内容の詳細

**期待される入力パラメータ（技術実装詳細.md）**:
- tenantId
- subscriptionId
- newExpiresAt

**実際の実装の入力パラメータ**:
```typescript
export interface ExtendSubscriptionPeriodInput {
  subscriptionId: string;
  newPeriodStart: string; // ISO 8601
  newPeriodEnd: string;   // ISO 8601
  tenantId: string;
}
```

**期待される出力パラメータ（技術実装詳細.md）**: （明示的な記載なし）

**実際の実装の出力パラメータ**:
```typescript
export interface ExtendSubscriptionPeriodOutput {
  subscriptionId: string;
  currentPeriodEnd: string;
}
```

### 問題点

1. **パラメータの違い**:
   - 期待: `newExpiresAt`（1つの日時）
   - 実装: `newPeriodStart` + `newPeriodEnd`（2つの日時）
   - これは実装が技術実装詳細.mdより詳細になっている（開始日時と終了日時の両方を指定）
   - 統括責務から呼び出す際は、この2つのパラメータを渡す必要がある

2. **scheduled_cancellation対応**: ✅ 実装されている
   - `cancel_at_period_end: true`の場合は期限延長をスキップする処理が実装されている
   - これは技術実装詳細.mdの期待と一致している（213行目の記載を参照）

3. **Lambda関数としての定義**: ✅ 正しく実装されている
   - CDKでLambda関数として定義されている
   - 関数名: `${environment}-billing-subscription-internal-extend-period`

### Lambda関数定義状況
`subscription-management.ts` の179-188行目で定義済み。

---

## 統括責務が動作する上で必須の修正事項

### 1. **パラメータマッピングの調整が必要**

統括責務（Orchestration）のClientモジュール（`subscriptionManagementClient.ts`）を実装する際、以下のパラメータ名の違いに注意する必要があります:

| 技術実装詳細.mdの記載 | 実際の実装 | 関数名 |
|---------------------|-----------|--------|
| `platform` | `platformType` | createSubscription |
| `receiptData` | （存在しない） | createSubscription |
| `status` | `newStatus` | updateSubscriptionStatus |
| `statusReason` | （存在しない） | updateSubscriptionStatus |
| `newExpiresAt` | `newPeriodStart` + `newPeriodEnd` | extendSubscriptionPeriod |

### 2. **createSubscription関数の入力パラメータ追加が必要**

統括責務から`createSubscription`を呼び出す際、以下のパラメータを追加で渡す必要があります:
- `subscriptionStatus`: 'active' または 'pending_verification'
- `currentPeriodStart`: サブスクリプション開始日時（ISO 8601形式）
- `currentPeriodEnd`: サブスクリプション終了日時（ISO 8601形式）

これらの情報は、統括責務側でレシート検証時に取得し、この関数に渡す必要があります。

### 3. **extendSubscriptionPeriod関数の呼び出し方法調整**

技術実装詳細.mdでは`newExpiresAt`（1つの日時）を渡すことを想定していますが、実装では`newPeriodStart`と`newPeriodEnd`（2つの日時）を渡す必要があります。

統括責務のWebhookイベント処理フロー（webhookEventFlow.ts）では、Webhookイベントから取得した期間情報を2つのパラメータに分けて渡す実装が必要です。

### 4. **statusReason の設計判断が必要**

`updateSubscriptionStatus`関数に`statusReason`パラメータが存在しないため、ステータス変更理由を記録できません。

**選択肢**:
1. **現状のまま受け入れる**: ステータス変更理由は記録しない（シンプルな実装）
2. **パラメータを追加する**: `UpdateSubscriptionStatusInput`に`statusReason`（optional）を追加し、Repositoryレベルで対応する

技術実装詳細.mdでは`statusReason`が期待されているため、追加を推奨しますが、統括責務が動作する上での必須事項ではありません（オプショナルな機能）。

---

## 補足事項

### 1. CDK Construct での公開

`subscription-management.ts`の83-88行目および191-196行目で、4つのInternal関数が正しくエクスポートされています:

```typescript
public readonly internalFunctions: {
  createSubscription: NodejsFunction;
  updateSubscriptionStatus: NodejsFunction;
  getSubscription: NodejsFunction;
  extendSubscriptionPeriod: NodejsFunction;
};
```

これにより、統括責務（OrchestrationConstruct）から参照可能になっています。

### 2. IAM権限の設定

`subscription-management.ts`の318-361行目で、各Lambda関数に必要なIAM権限が適切に設定されています:
- テナントテーブル読み取り権限
- Cognito権限
- RDS IAM認証権限

統括責務のLambda関数には、これらのInternal関数を呼び出すための`lambda:InvokeFunction`権限を付与する必要があります。

### 3. エラーハンドリング

すべてのInternal関数で、適切なエラークラスとエラーハンドリングが実装されています:
- `CreateSubscriptionError`
- `UpdateSubscriptionStatusError`
- `GetSubscriptionError`
- `ExtendSubscriptionPeriodError`

統括責務から呼び出す際は、これらのエラーをキャッチして適切に処理する必要があります。

### 4. RDS接続の実装

すべてのInternal関数で、`tenantId`を使用したマルチテナント対応のRDS接続が実装されています。統括責務から呼び出す際は、必ず`tenantId`を渡す必要があります。

### 5. 冪等性の考慮

- `updateSubscriptionStatus`関数: 同じステータスへの更新は許可（119-132行目）
- `extendSubscriptionPeriod`関数: `cancel_at_period_end: true`の場合はスキップ（119-130行目）

これらの実装により、統括責務からのリトライ時に冪等性が保証されます。
