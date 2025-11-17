# レビュー結果: Lambda Billing - Subscription Management

## 担当ファイル
- packages/cdk/lambda/billing/subscription-management/internal/createSubscription.ts
- packages/cdk/lambda/billing/subscription-management/internal/getSubscription.ts
- packages/cdk/lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts
- packages/cdk/lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts

## 重大な問題（Critical）

### 1. インポートパスの不整合（全ファイル）

**問題箇所**: 全ファイルで共通

```typescript
import { SubscriptionRepository } from '../../../repositories';
import { getRdsConnection } from '../../../utils/rdsConnection';
```

**現状の問題**:
- `../../../repositories` は `/packages/cdk/lambda/repositories` を指している
- `../../../utils` は `/packages/cdk/lambda/utils` を指している
- しかし、実際のコードは `/packages/cdk/lambda/billing/data-access/repositories` に存在している

**影響**:
- インポートパスが正しく解決されず、実行時エラーが発生する可能性が高い
- 2つの異なるrepositories実装が存在している状態
  - `/packages/cdk/lambda/repositories` (古い実装)
  - `/packages/cdk/lambda/billing/data-access/repositories` (新しい実装)

**推奨対応**:
```typescript
// 正しいインポートパス（billing配下のdata-access層を使用する場合）
import { SubscriptionRepository } from '../../data-access/repositories';
import { getRdsConnection } from '../../data-access/getRdsConnectionForVpc';
```

または、全体のリポジトリ構造を整理し、どちらのrepositories実装を使用するか明確化する必要があります。

### 2. トランザクション管理の欠如（全ファイル）

**問題箇所**: 全ファイルで共通

現在の実装では、複数のDB操作が発生する場合でもトランザクション制御が実装されていません。

**影響**:
- `createSubscription.ts`: 重複チェックと作成の間でrace conditionが発生する可能性
- `extendSubscriptionPeriod.ts`: 存在確認と更新の間で不整合が発生する可能性
- `updateSubscriptionStatus.ts`: 同様の問題

**推奨対応**:
データベース操作を適切にトランザクション内で実行する必要があります。

## 警告レベルの問題（Warning）

### 1. エラーハンドリングの型安全性（全ファイル）

**問題箇所**: 例: `createSubscription.ts` L98-106

```typescript
const rdsConnection = await getRdsConnection({
  requestContext: {
    authorizer: {
      claims: {
        'custom:tenant_id': input.tenantId,
      },
    },
  },
} as any);
```

**問題点**:
- `as any` による型キャストでTypeScriptの型チェックを回避している
- `getRdsConnection` の実際の引数型は `APIGatewayProxyEvent` であり、この構造とは異なる

**影響**:
- 実行時エラーの可能性が高い
- `getRdsConnection` 内部で期待される他のプロパティが欠けている可能性

### 2. ステータス遷移の妥当性チェック不足（updateSubscriptionStatus.ts）

**問題箇所**: `updateSubscriptionStatus.ts` L116-132

```typescript
// 状態遷移の妥当性チェック
const previousStatus = existingSubscription.subscription_status;

// 同じステータスへの更新は許可（冪等性のため）
if (previousStatus === input.newStatus) {
  console.log('Status is already the same, skipping update:', {
    subscriptionId: input.subscriptionId,
    status: previousStatus,
  });

  return {
    subscriptionId: existingSubscription.subscription_id,
    previousStatus,
    newStatus: input.newStatus,
    updatedAt: existingSubscription.updated_at.toISOString(),
  };
}
```

**問題点**:
- コメントに「状態遷移の妥当性チェック」と記載されているが、実際には同一性チェックのみ
- 不正な状態遷移（例: `canceled` → `active`）を許可してしまう

**推奨対応**:
状態遷移マトリクスを定義し、許可される遷移のみを実行する:

```typescript
const validTransitions: Record<string, string[]> = {
  'pending_verification': ['active', 'rejected'],
  'active': ['past_due', 'canceled', 'expired'],
  'past_due': ['active', 'canceled', 'expired'],
  'canceled': [], // canceledからの遷移は不可
  'expired': [], // expiredからの遷移は不可
  'rejected': [], // rejectedからの遷移は不可
};
```

### 3. 期限延長ロジックの不完全性（extendSubscriptionPeriod.ts）

**問題箇所**: `extendSubscriptionPeriod.ts` L119-130

```typescript
// scheduled_cancellation（cancel_at_period_end: true）の場合は延長しない
if (existingSubscription.cancel_at_period_end) {
  console.log('Subscription is scheduled for cancellation, skipping period extension:', {
    subscriptionId: input.subscriptionId,
    cancelAtPeriodEnd: existingSubscription.cancel_at_period_end,
  });

  return {
    subscriptionId: existingSubscription.subscription_id,
    currentPeriodEnd: existingSubscription.current_period_end.toISOString(),
  };
}
```

**問題点**:
- キャンセル予定のサブスクリプションで延長をスキップするのは正しい
- しかし、他のステータス（`canceled`, `expired`, `rejected`）のチェックが不足している

**推奨対応**:
```typescript
// 延長可能なステータスのチェック
const extendableStatuses = ['active', 'past_due'];
if (!extendableStatuses.includes(existingSubscription.subscription_status)) {
  throw new ExtendSubscriptionPeriodError(
    'INVALID_STATUS',
    `サブスクリプションのステータスが延長不可です: ${existingSubscription.subscription_status}`
  );
}

// scheduled_cancellationのチェック
if (existingSubscription.cancel_at_period_end) {
  // ...
}
```

### 4. 日付検証の不完全性（createSubscription.ts, extendSubscriptionPeriod.ts）

**問題箇所**: `createSubscription.ts` L76-83

```typescript
if (periodEnd <= periodStart) {
  throw new Error('Period end must be after period start');
}
```

**問題点**:
- 過去の日付のチェックがない
- 期間が異常に長い場合のチェックがない（例: 100年後など）

**推奨対応**:
```typescript
// 過去の日付チェック
const now = new Date();
if (periodStart < now) {
  throw new CreateSubscriptionError(
    'INVALID_DATE',
    'サブスクリプション開始日は現在時刻より後である必要があります'
  );
}

// 期間の妥当性チェック（例: 最大2年など）
const maxPeriodDays = 365 * 2;
const periodDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
if (periodDays > maxPeriodDays) {
  throw new CreateSubscriptionError(
    'INVALID_DATE',
    `サブスクリプション期間が長すぎます（最大${maxPeriodDays}日）`
  );
}
```

## 軽微な問題・改善提案（Info）

### 1. ログ出力の改善

**現状**:
```typescript
console.log('createSubscription input:', JSON.stringify(input, null, 2));
```

**推奨**:
- 構造化ログ（JSON形式）を採用
- ログレベルの適切な設定（info, warn, error）
- 機密情報（tenantIdなど）のマスキング

### 2. エラーコードの一貫性

**現状**:
各ファイルで独自のエラーコードを定義していますが、体系的な設計がなされていません。

**推奨**:
エラーコードを一元管理し、プレフィックスで分類:
- `SUB_CREATE_xxx`: サブスクリプション作成関連
- `SUB_UPDATE_xxx`: サブスクリプション更新関連
- `SUB_EXTEND_xxx`: 期限延長関連

### 3. バリデーションロジックの分離

**現状**:
バリデーションロジックがハンドラー内に直接記述されています。

**推奨**:
バリデーション関数を別ファイルに分離し、テストしやすくする:

```typescript
// validators/subscriptionValidator.ts
export function validateCreateSubscriptionInput(input: CreateSubscriptionInput): void {
  if (!input.userId || !input.planId || !input.platformSubscriptionId) {
    throw new CreateSubscriptionError('INVALID_INPUT', '必須パラメータが不足しています');
  }
  // ...
}
```

### 4. テスト容易性の向上

**現状**:
ハンドラー関数内で直接RDS接続を取得しており、モックが困難です。

**推奨**:
依存性注入を活用し、テスト時にリポジトリをモック可能にする:

```typescript
export async function createSubscription(
  input: CreateSubscriptionInput,
  repository?: SubscriptionRepository
): Promise<CreateSubscriptionOutput> {
  const repo = repository || new SubscriptionRepository(await getRdsConnection(event));
  // ...
}
```

### 5. 型定義の厳密化

**問題箇所**: `createSubscription.ts` L147

```typescript
status: createdSubscription.subscription_status as 'active' | 'pending_verification',
```

**問題点**:
型アサーションに依存しており、実行時に他のステータスが返される可能性を排除できていません。

**推奨対応**:
返却値の型を厳密に検証:

```typescript
const validReturnStatuses: Array<'active' | 'pending_verification'> = ['active', 'pending_verification'];
if (!validReturnStatuses.includes(createdSubscription.subscription_status as any)) {
  throw new CreateSubscriptionError(
    'INTERNAL_ERROR',
    `予期しないステータスが返されました: ${createdSubscription.subscription_status}`
  );
}

return {
  subscriptionId: createdSubscription.subscription_id,
  status: createdSubscription.subscription_status as 'active' | 'pending_verification',
};
```

### 6. リソースクリーンアップ

**現状**:
RDS接続のクローズ処理が実装されていません。

**推奨**:
Lambda関数終了時に適切にコネクションをクローズ:

```typescript
let connection: any = null;
try {
  connection = await getRdsConnection(event);
  // ...処理...
} finally {
  if (connection && connection.end) {
    await connection.end();
  }
}
```

### 7. 入力パラメータのtenantIdバリデーション

**現状**:
tenantIdの存在チェックが不足しています。

**推奨**:
```typescript
if (!input.tenantId) {
  throw new CreateSubscriptionError(
    'INVALID_INPUT',
    'テナントIDが必要です',
    { tenantId: !!input.tenantId }
  );
}
```

## データ整合性に関する懸念

### 1. 重複チェックのrace condition（createSubscription.ts）

**問題箇所**: L111-124

トランザクション外で重複チェックを行っているため、並行実行時に同じplatform_subscription_idで複数のレコードが作成される可能性があります。

**推奨対応**:
- データベース側でUNIQUE制約を追加
- トランザクション内で処理を実行
- または、UPSERT（INSERT ... ON CONFLICT）を使用

### 2. 外部キー制約の妥当性チェック不足

**問題点**:
- `planId` の存在チェックがない
- `userId` の存在チェックがない

データベース側で外部キー制約が設定されている場合は問題ありませんが、アプリケーション層でもチェックすることで、より分かりやすいエラーメッセージを返せます。

## 総合評価

**要修正**

### 主な理由:

1. **Critical**: インポートパスの不整合により、コードが正常に動作しない可能性が極めて高い
2. **Critical**: トランザクション管理の欠如により、データ整合性が保証されない
3. **Warning**: getRdsConnectionの引数型不一致により、実行時エラーの可能性
4. **Warning**: 状態遷移の妥当性チェック不足により、不正な状態遷移を許可

### 修正優先度:

1. **最優先**: インポートパスの修正とrepositories構造の整理
2. **高**: トランザクション管理の実装
3. **高**: getRdsConnection呼び出しの修正
4. **中**: 状態遷移の妥当性チェック実装
5. **中**: 日付検証の強化

### ポジティブな点:

- エラーハンドリングの基本構造は適切
- 入力バリデーションの実装意識がある
- コメントが適切に記載されている
- 責務が明確に分離されている（内部用Lambda-to-Lambda呼び出し）

### 次のステップ:

1. インポートパスを修正し、正しいrepositories実装を参照
2. BaseRepositoryにトランザクション管理機能を追加
3. 状態遷移ロジックの実装
4. 統合テストの実施
