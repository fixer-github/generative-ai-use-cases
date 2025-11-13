# Subscription Management実装調査結果

## 調査概要
- **調査日時**: 2025-11-13
- **調査対象**: Subscription Management責務の実装状況
- **調査箇所**:
  - `/packages/cdk/lib/construct/api/subscription-management.ts` (CDK構成)
  - `/packages/cdk/lambda/billing/admin/subscription-management/` (Lambda関数実装)
  - `/packages/cdk/lambda/repositories/subscriptionRepository.ts` (リポジトリ層)
  - `/packages/cdk/lambda/repositories/userPlanApplicationRepository.ts` (リポジトリ層)

---

## 1. サブスクリプションCRUD API

### 1.1 実装状況

#### ✅ 実装済み機能

**SubscriptionRepository (リポジトリ層)**
- ✅ `create()` - サブスクリプション作成
- ✅ `findById()` - サブスクリプションID検索
- ✅ `findByPlatformSubscriptionId()` - プラットフォームサブスクリプションID検索
- ✅ `findByUserId()` - ユーザID検索
- ✅ `findByUserIdAndStatus()` - ユーザID+ステータス検索
- ✅ `findActiveByUserId()` - ユーザの有効サブスクリプション取得
- ✅ `findPendingVerification()` - 検証保留中サブスクリプション一覧
- ✅ `findExpiringSoon()` - 期限切れ間近のサブスクリプション一覧
- ✅ `update()` - サブスクリプション更新（汎用）
- ✅ `cancel()` - サブスクリプションキャンセル
- ✅ `scheduleCancel()` - 期限終了時キャンセル予約
- ✅ `extendPeriod()` - 期限延長

**管理者向けAPI (Lambda関数)**
- ✅ `getStatistics` - サブスクリプション統計取得
- ✅ `listSubscriptions` - サブスクリプション一覧取得（検索・絞り込み・ソート・ページネーション対応）
- ✅ `getSubscription` - サブスクリプション詳細取得
- ✅ `approveSubscription` - 検証保留サブスクリプション承認
- ✅ `rejectSubscription` - 検証保留サブスクリプション却下

**サポートしているステータス一覧**
```typescript
subscription_status:
  | 'active'              // 有効
  | 'pending_verification' // 検証保留中
  | 'past_due'            // 支払い遅延（猶予期間中）
  | 'canceled'            // キャンセル済み
  | 'expired'             // 期限切れ
  | 'rejected'            // 却下済み（管理者による手動却下）
```

#### ❌ 未実装機能（統括責務で必要）

**Lambda-to-Lambda呼び出し対応**
- ❌ 現在の実装は管理者向けAPIのみ（API Gateway経由）
- ❌ 他のLambda関数から直接呼び出すためのインターフェースが存在しない
- ❌ 統括責務から呼び出す際のエラーハンドリング・リトライ機構が未実装

**サブスクリプションCRUD操作のLambda関数化**
- ❌ `createSubscription` Lambda関数が存在しない
- ❌ `updateSubscriptionStatus` Lambda関数が存在しない
- ❌ `recordPaymentHistory` Lambda関数が存在しない
- ❌ リポジトリ層のメソッドは存在するが、Lambda関数として公開されていない

### 1.2 必須修正事項

#### 🔴 高優先度: Lambda関数の追加実装

**1. createSubscription Lambda関数**
- **目的**: 統括責務の購入フローから呼び出し可能にする
- **入力**:
  ```typescript
  {
    userId: string;
    planId: string;
    platformType: 'stripe' | 'apple' | 'google';
    platformSubscriptionId: string;
    subscriptionStatus: 'active' | 'pending_verification';
    currentPeriodStart: string; // ISO 8601
    currentPeriodEnd: string;   // ISO 8601
  }
  ```
- **出力**:
  ```typescript
  {
    subscriptionId: string;
    status: string;
  }
  ```
- **実装場所**: `/packages/cdk/lambda/billing/subscription-management/createSubscription.ts`（新規作成）

**2. updateSubscriptionStatus Lambda関数**
- **目的**: 統括責務のWebhookイベントハンドラーから状態更新を呼び出し可能にする
- **入力**:
  ```typescript
  {
    subscriptionId: string;
    newStatus: 'active' | 'past_due' | 'canceled' | 'expired';
  }
  ```
- **出力**:
  ```typescript
  {
    subscriptionId: string;
    previousStatus: string;
    newStatus: string;
    updatedAt: string;
  }
  ```
- **実装場所**: `/packages/cdk/lambda/billing/subscription-management/updateSubscriptionStatus.ts`（新規作成）

**3. extendSubscriptionPeriod Lambda関数**
- **目的**: 統括責務のWebhookイベントハンドラーから期限延長を呼び出し可能にする
- **入力**:
  ```typescript
  {
    subscriptionId: string;
    newPeriodStart: string; // ISO 8601
    newPeriodEnd: string;   // ISO 8601
  }
  ```
- **出力**:
  ```typescript
  {
    subscriptionId: string;
    currentPeriodEnd: string;
  }
  ```
- **実装場所**: `/packages/cdk/lambda/billing/subscription-management/extendSubscriptionPeriod.ts`（新規作成）

**4. recordPaymentHistory Lambda関数**
- **目的**: 支払い履歴を記録する（将来的な監査・レポート用）
- **注**: 支払い履歴テーブル自体が未実装の可能性あり。将来対応として記載。
- **実装場所**: `/packages/cdk/lambda/billing/subscription-management/recordPaymentHistory.ts`（新規作成、低優先度）

#### 🟡 中優先度: CDK構成の修正

**CDK構成ファイル修正**
- **ファイル**: `/packages/cdk/lib/construct/api/subscription-management.ts`
- **修正内容**:
  1. 新規Lambda関数の追加（createSubscription, updateSubscriptionStatus, extendSubscriptionPeriod）
  2. Lambda関数名の環境変数エクスポート（統括責務から参照可能にする）
  3. Lambda呼び出し権限の付与（統括責務のLambda関数に対して）

**例: 環境変数エクスポート**
```typescript
// billing-management-stack.tsで以下を追加
this.subscriptionMgmtFunctionNames = {
  create: createSubscriptionFunction.functionName,
  updateStatus: updateSubscriptionStatusFunction.functionName,
  extendPeriod: extendSubscriptionPeriodFunction.functionName,
};
```

---

## 2. 検証保留機能

### 2.1 実装状況

#### ✅ 実装済み機能

**pending_verification状態の管理**
- ✅ SubscriptionRepository.create()で`subscription_status: 'pending_verification'`を指定可能
- ✅ SubscriptionRepository.findPendingVerification()で検証保留中サブスクリプション一覧取得

**手動承認・却下API**
- ✅ `POST /admin/billing/subscriptions/{subscription_id}/approve` - 承認API実装済み
- ✅ `POST /admin/billing/subscriptions/{subscription_id}/reject` - 却下API実装済み

**承認処理の内容 (approveSubscription.ts)**
1. ✅ サブスクリプションのステータスを`pending_verification` → `active`に更新
2. ✅ UserPlanApplication（プラン適用）レコードを作成
3. ⚠️ TODO: OpenFGAに権限登録（未実装、コメントで記載）
4. ⚠️ TODO: 利用回数カウンター初期化（未実装、コメントで記載）
5. ⚠️ TODO: ユーザ通知送信（未実装、コメントで記載）
6. ⚠️ TODO: 監査ログ記録（未実装、コメントで記載）

**却下処理の内容 (rejectSubscription.ts)**
1. ✅ サブスクリプションのステータスを`pending_verification` → `rejected`に更新
2. ⚠️ TODO: 却下理由・却下管理者の記録（履歴テーブルへ、未実装）
3. ⚠️ TODO: ユーザ通知送信（未実装、コメントで記載）
4. ⚠️ TODO: 監査ログ記録（未実装、コメントで記載）

**保留中サブスクリプション一覧取得**
- ✅ `GET /admin/billing/subscriptions?status=pending_verification`で取得可能
- ✅ listSubscriptions APIのフィルタ機能で実装済み

### 2.2 必須修正事項

#### 🔴 高優先度: 承認・却下後の連携処理

**1. 権限管理サービス連携（OpenFGA/カウント機構）**
- **現状**: TODOコメントのみ、実装なし
- **必要な処理**:
  - 承認時: プランの`permissions.features`に基づいてOpenFGAに権限登録
  - 承認時: プランの`permissions.limits`に基づいてカウンター初期化
  - 却下時: 権限付与なし（何もしない）
- **対応**: 統括責務実装時に`authorizationService`を作成し、承認・却下処理から呼び出す

**2. 履歴テーブルへの記録**
- **現状**: ステータス変更履歴を記録する機構が存在しない
- **必要なテーブル**: `subscription_status_history`（新規作成必要）
  ```sql
  CREATE TABLE subscription_status_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL,
    previous_status VARCHAR(50) NOT NULL,
    new_status VARCHAR(50) NOT NULL,
    changed_by VARCHAR(255),  -- 管理者のユーザ名
    rejection_reason VARCHAR(50),
    rejection_details TEXT,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
  );
  ```
- **対応**: リポジトリ層に`SubscriptionStatusHistoryRepository`を追加

#### 🟡 中優先度: 通知機能

**3. ユーザ通知の実装**
- **現状**: TODOコメントのみ、通知サービス自体が未実装
- **必要な処理**:
  - 承認時: 「プランが有効になりました」通知
  - 却下時: 「検証に失敗しました。サポートにお問い合わせください」通知
- **対応**: 将来的に通知サービスが実装されたら連携

---

## 3. 状態管理

### 3.1 実装状況

#### ✅ サポートしているステータス一覧

**Subscription.subscription_status型定義** (`/packages/cdk/lambda/repositories/types.ts`)
```typescript
subscription_status:
  | 'active'              // 有効
  | 'pending_verification' // 検証保留中
  | 'past_due'            // 支払い遅延
  | 'canceled'            // キャンセル済み
  | 'expired'             // 期限切れ
  | 'rejected'            // 却下済み
```

**UserPlanApplication.application_status型定義**
```typescript
application_status:
  | 'active'              // 有効
  | 'scheduled_termination' // 解約予定（期限終了時まで有効）
  | 'expired'             // 期限切れ
```

#### ✅ 実装済み状態遷移

**SubscriptionRepository**
- ✅ `cancel()` - active → canceled
- ✅ `scheduleCancel()` - active → cancel_at_period_end=true（scheduled_cancellationに相当）
- ✅ `extendPeriod()` - 期限延長（activeのまま期限更新）
- ✅ `update()` - 任意のステータスへの更新

**UserPlanApplicationRepository**
- ✅ `scheduleTermination()` - active → scheduled_termination
- ✅ `expire()` - scheduled_termination → expired
- ✅ `extendValidity()` - 期限延長（activeのままvalid_until更新）

### 3.2 scheduled_cancellation状態のサポート

#### ⚠️ 部分実装

**現状の実装**
- Subscription型に`cancel_at_period_end: boolean`フィールドが存在
- SubscriptionRepository.scheduleCancel()で`cancel_at_period_end: true`に設定可能
- **ただし**、`subscription_status`は`active`のまま維持

**技術実装詳細.mdの期待仕様**
```typescript
// 期待: scheduled_cancellation という明示的なステータス
subscription_status: 'scheduled_cancellation'
```

**現在の実装方式**
```typescript
// 実装: フラグで表現
subscription_status: 'active'
cancel_at_period_end: true
```

#### 差異の分析

**判断**:
- 現在の実装方式（`cancel_at_period_end`フラグ）はStripe標準の実装方式と一致
- Apple/Googleのサブスクリプションでも同様のパターンが一般的
- **結論**: 明示的な`scheduled_cancellation`ステータスを追加せず、現在の実装方式を維持することを推奨
- ただし、統括責務のドキュメントで「scheduled_cancellationは`status: active && cancel_at_period_end: true`で表現する」と明記する必要あり

### 3.3 必須修正事項

#### 🟢 低優先度: ドキュメント修正のみ

**1. scheduled_cancellation表現方法の明確化**
- **対応**: 技術実装詳細.mdに以下を追記
  ```markdown
  ## scheduled_cancellation状態の表現方法

  scheduled_cancellation状態は、subscription_statusフィールドに独立したステータスとして
  持たず、以下の組み合わせで表現します:

  - subscription_status: 'active'
  - cancel_at_period_end: true

  この実装方式はStripe標準のサブスクリプション管理方式と一致します。
  ```

---

## 4. Lambda関数の呼び出しインターフェース

### 4.1 実装状況

#### ❌ 現状: Lambda-to-Lambda呼び出し未対応

**管理者向けAPIのみ実装**
- 現在の実装は`API Gateway → Lambda`の構成のみ
- 入力: APIGatewayProxyEvent（HTTP リクエスト）
- 出力: APIGatewayProxyResult（HTTP レスポンス）

**問題点**
- 統括責務のLambda関数から直接呼び出すことができない
- AWS SDK Lambda.invoke()で呼び出す際、API Gateway用のイベント構造を手動構築する必要がある
- エラーハンドリングがHTTPステータスコードに依存しており、Lambda間呼び出しに不向き

### 4.2 必須修正事項

#### 🔴 高優先度: Lambda-to-Lambda呼び出し用の関数追加

**アプローチ1: 既存関数を汎用化（非推奨）**
- 既存の管理者向けAPI関数を、API Gateway経由と直接呼び出しの両方に対応させる
- **デメリット**: 認証機構の複雑化、入力バリデーションの二重化

**アプローチ2: 内部用Lambda関数の追加（推奨）**
- `/packages/cdk/lambda/billing/subscription-management/internal/`配下に内部用関数を作成
- API Gateway非公開、Lambda-to-Lambda呼び出し専用
- エラーハンドリングは例外スローベース（HTTPステータスコード非依存）

**必要な内部用Lambda関数**

**1. createSubscription（内部用）**
- **ファイル**: `/packages/cdk/lambda/billing/subscription-management/internal/createSubscription.ts`
- **入力形式**:
  ```typescript
  interface CreateSubscriptionInput {
    userId: string;
    planId: string;
    platformType: 'stripe' | 'apple' | 'google';
    platformSubscriptionId: string;
    subscriptionStatus: 'active' | 'pending_verification';
    currentPeriodStart: string;
    currentPeriodEnd: string;
  }
  ```
- **出力形式**:
  ```typescript
  interface CreateSubscriptionOutput {
    subscriptionId: string;
    status: 'active' | 'pending_verification';
  }
  ```
- **エラーハンドリング**: 例外をスロー（エラーメッセージとエラーコードを含む）

**2. updateSubscriptionStatus（内部用）**
- **ファイル**: `/packages/cdk/lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts`
- **入力形式**:
  ```typescript
  interface UpdateSubscriptionStatusInput {
    subscriptionId: string;
    newStatus: 'active' | 'past_due' | 'canceled' | 'expired';
  }
  ```
- **出力形式**:
  ```typescript
  interface UpdateSubscriptionStatusOutput {
    subscriptionId: string;
    previousStatus: string;
    newStatus: string;
    updatedAt: string;
  }
  ```

**3. getSubscription（内部用）**
- **ファイル**: `/packages/cdk/lambda/billing/subscription-management/internal/getSubscription.ts`
- **入力形式**:
  ```typescript
  interface GetSubscriptionInput {
    subscriptionId: string;
  }
  ```
- **出力形式**:
  ```typescript
  interface GetSubscriptionOutput {
    subscription: Subscription;
  }
  ```

**4. extendSubscriptionPeriod（内部用）**
- **ファイル**: `/packages/cdk/lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts`
- **入力形式**:
  ```typescript
  interface ExtendSubscriptionPeriodInput {
    subscriptionId: string;
    newPeriodStart: string;
    newPeriodEnd: string;
  }
  ```
- **出力形式**:
  ```typescript
  interface ExtendSubscriptionPeriodOutput {
    subscriptionId: string;
    currentPeriodEnd: string;
  }
  ```

#### 🟡 中優先度: CDK構成の追加

**CDK構成ファイル修正**
- **ファイル**: `/packages/cdk/lib/construct/api/subscription-management.ts`
- **修正内容**:
  1. 内部用Lambda関数を追加（API Gatewayには紐付けない）
  2. Lambda関数名をエクスポート（統括責務から参照可能にする）
  3. Lambda呼び出し権限の付与

**例: Lambda関数名のエクスポート**
```typescript
export class SubscriptionManagementApi extends Construct {
  public readonly internalFunctions = {
    createSubscription: NodejsFunction;
    updateSubscriptionStatus: NodejsFunction;
    getSubscription: NodejsFunction;
    extendSubscriptionPeriod: NodejsFunction;
  };

  constructor(...) {
    // ... 内部用Lambda関数の作成
    this.internalFunctions.createSubscription = createSubscriptionFunction;
    this.internalFunctions.updateSubscriptionStatus = updateSubscriptionStatusFunction;
    // ...
  }
}
```

---

## 5. 統括責務実装のための必須修正事項まとめ

### 5.1 実装が必須の項目

#### 🔴 Pハイ: Lambda-to-Lambda呼び出し対応（統括責務実装前に必須）

- [ ] **修正1**: 内部用createSubscription Lambda関数の実装
  - 場所: `/packages/cdk/lambda/billing/subscription-management/internal/createSubscription.ts`
  - 理由: 統括責務の購入フローから呼び出すため
  - 実装工数: 0.5日

- [ ] **修正2**: 内部用updateSubscriptionStatus Lambda関数の実装
  - 場所: `/packages/cdk/lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts`
  - 理由: 統括責務のWebhookイベントハンドラーから状態更新を呼び出すため
  - 実装工数: 0.5日

- [ ] **修正3**: 内部用getSubscription Lambda関数の実装
  - 場所: `/packages/cdk/lambda/billing/subscription-management/internal/getSubscription.ts`
  - 理由: 統括責務のプラン変更フロー・解約フローから現在の状態を取得するため
  - 実装工数: 0.3日

- [ ] **修正4**: 内部用extendSubscriptionPeriod Lambda関数の実装
  - 場所: `/packages/cdk/lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts`
  - 理由: 統括責務のWebhookイベントハンドラー（payment.succeeded）から期限延長を呼び出すため
  - 実装工数: 0.3日

- [ ] **修正5**: CDK構成の修正（内部用Lambda関数の追加）
  - 場所: `/packages/cdk/lib/construct/api/subscription-management.ts`
  - 内容:
    - 内部用Lambda関数の作成
    - Lambda関数名のエクスポート
    - Lambda呼び出し権限の付与
  - 実装工数: 0.5日

#### 🟡 中優先度: 権限管理・履歴記録（統括責務実装と並行可能）

- [ ] **修正6**: SubscriptionStatusHistoryRepository の実装
  - 場所: `/packages/cdk/lambda/repositories/subscriptionStatusHistoryRepository.ts`
  - 理由: 承認・却下の履歴を記録するため
  - 実装工数: 0.5日
  - 備考: RDBにsubscription_status_historyテーブルの追加が必要

- [ ] **修正7**: approveSubscription/rejectSubscriptionでの履歴記録処理追加
  - 場所:
    - `/packages/cdk/lambda/billing/admin/subscription-management/approveSubscription.ts`
    - `/packages/cdk/lambda/billing/admin/subscription-management/rejectSubscription.ts`
  - 実装工数: 0.3日

- [ ] **修正8**: 権限管理サービス連携（OpenFGA/カウント機構）
  - 場所: approveSubscription.ts内のTODO箇所
  - 理由: プラン承認時に権限を付与する
  - 実装工数: 1.0日（権限管理サービスの実装状況に依存）
  - 備考: 権限管理サービスが未実装の場合、モック実装で代替

### 5.2 ドキュメント修正のみで対応可能な項目

- [ ] **修正9**: scheduled_cancellation状態の表現方法を技術実装詳細.mdに明記
  - 理由: 現在の実装（`cancel_at_period_end`フラグ）と期待仕様の差異を明確化
  - 実装工数: 0.1日

### 5.3 将来対応（統括責務実装には不要）

- [ ] 修正10: recordPaymentHistory Lambda関数の実装（低優先度）
- [ ] 修正11: ユーザ通知機能の連携（通知サービス実装後）

---

## 6. 実装優先度と推奨スケジュール

### フェーズ1: 統括責務実装前の準備（必須、推定2.5日）
1. 内部用createSubscription Lambda関数実装（0.5日）
2. 内部用updateSubscriptionStatus Lambda関数実装（0.5日）
3. 内部用getSubscription Lambda関数実装（0.3日）
4. 内部用extendSubscriptionPeriod Lambda関数実装（0.3日）
5. CDK構成の修正（0.5日）
6. scheduled_cancellationドキュメント修正（0.1日）
7. 単体テスト作成（0.7日）

### フェーズ2: 統括責務実装と並行（並行可能、推定1.8日）
8. SubscriptionStatusHistoryRepository実装（0.5日）
9. 履歴記録処理の追加（0.3日）
10. 権限管理サービス連携（1.0日、または権限管理サービス実装完了まで保留）

### フェーズ3: 将来対応（統括責務実装後）
11. recordPaymentHistory実装
12. ユーザ通知連携

---

## 7. リスクと対策

### リスク1: 権限管理サービス未実装
- **影響**: 承認処理で権限付与ができない
- **対策**:
  - 短期: モック実装で代替（ログ出力のみ）
  - 長期: 権限管理サービス実装完了後に連携

### リスク2: Lambda-to-Lambda呼び出しのレイテンシー
- **影響**: 統括責務のフロー実行時間が増加
- **対策**:
  - 各Lambda関数の処理時間を最適化
  - 必要に応じて並列実行を検討

### リスク3: RDB接続プール枯渇
- **影響**: 同時実行数が多い場合にDB接続エラー
- **対策**:
  - RDS Proxyの接続プール設定を調整
  - Lambda関数内での適切な接続管理（接続リークの防止）

---

## 8. 結論

### 現状評価
- **良好な点**:
  - リポジトリ層のCRUD操作は充実している
  - 管理者向けAPIは完成度が高い
  - 検証保留機能の基本実装は完了している
- **課題**:
  - Lambda-to-Lambda呼び出し対応が未実装
  - 権限管理サービス連携が未完成
  - 履歴記録機構が存在しない

### 統括責務実装への影響
- **必須修正事項**: 5項目（フェーズ1）を完了すれば統括責務実装に進める
- **推定工数**: 2.5日（テスト込み）
- **並行実装可能**: 権限管理・履歴記録はフェーズ2として並行実装可能

### 推奨アクション
1. フェーズ1の修正（内部用Lambda関数追加）を最優先で実施
2. 統括責務実装と並行してフェーズ2（権限管理・履歴）を進める
3. scheduled_cancellation表現方法をドキュメントに明記
