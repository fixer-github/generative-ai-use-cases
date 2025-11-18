# Orchestration実装計画書

## 1. 実装済みモジュールの分析

### 1.1 Types（型定義）

#### flowTypes.ts
**役割**: フロー実行に関する型定義を提供
- `FlowType`: 4種類のフロー（purchase, plan_change, cancellation, webhook_event）を定義
- `FlowExecutionStatus`: フロー実行ステータス（in_progress, completed, failed, rolled_back）
- `FlowExecution`: DynamoDB履歴テーブルのレコード構造
  - テーブル名: `{tenant-id}-flow-execution-history`
  - 主キー: `flowExecutionId` (PK), `startedAt` (SK)
  - GSI: `userId-startedAt-index`, `tenantId-flowType-index`, `status-startedAt-index`
  - TTL: 1年後に自動削除
- 入力/出力型:
  - `PurchaseFlowInput/Output`: 購入フロー
  - `PlanChangeFlowInput/Output`: プラン変更フロー
  - `CancellationFlowInput/Output`: 解約フロー

**完成度**: 完成（実装変更不要）

#### stepTypes.ts
**役割**: ステップ実行に関する型定義を提供
- `StepType`: ステップの種類（validation, api_call, data_write, rollback）
- `StepStatus`: ステップ実行ステータス（in_progress, completed, failed, skipped）
- `StepExecution`: DynamoDB履歴テーブルのレコード構造
  - テーブル名: `{tenant-id}-flow-step-execution-history`
  - 主キー: `flowExecutionId` (PK), `stepSequence` (SK)
  - ロールバックステップは負のステップシーケンスを使用（-1, -2, ...）
  - TTL: 1年後に自動削除
- `StepConfig`: ステップ設定（実行関数、ロールバック関数、リトライ設定）
- `StepExecutionResult`: ステップ実行結果

**完成度**: 完成（実装変更不要）

#### eventTypes.ts
**役割**: Webhookイベント処理に関する型定義を提供
- `WebhookEventType`: 各プラットフォームのイベントタイプ
  - Stripe: payment.succeeded, payment.failed, subscription.canceled, refund.created
  - Apple: RENEWAL, DID_FAIL_TO_RENEW, DID_CHANGE_RENEWAL_STATUS, REFUND
  - Google: SUBSCRIPTION_RENEWED, SUBSCRIPTION_EXPIRED, SUBSCRIPTION_CANCELED, SUBSCRIPTION_REFUNDED
- `WebhookEventPayload`: EventBridgeから渡されるイベント構造（署名検証・重複チェック済み）
- プラットフォーム固有のデータ構造:
  - `StripeEventData`, `AppleEventData`, `GoogleEventData`

**完成度**: 完成（実装変更不要）

### 1.2 Repositories（データアクセス層）

#### flowExecutionRepository.ts
**役割**: フロー実行履歴のCRUD操作を提供
- `create()`: 新しいフロー実行レコードの作成
- `update()`: フロー実行レコードの更新（ステータス、完了時刻、結果、エラー詳細、進行状況）
- `getById()`: フロー実行IDによる取得
- `listByUser()`: ユーザIDによる一覧取得（GSI: userId-startedAt-index）
- `listByStatus()`: ステータスによる一覧取得（GSI: status-startedAt-index）
- `listByTenantAndFlowType()`: テナントIDとフロータイプによる一覧取得（GSI: tenantId-flowType-index）

**完成度**: 完成（実装変更不要）

**注意点**: DynamoDBテーブルは別途CDKで作成する必要がある

#### flowStepExecutionRepository.ts
**役割**: ステップ実行履歴のCRUD操作を提供
- `create()`: 新しいステップ実行レコードの作成
- `update()`: ステップ実行レコードの更新（ステータス、完了時刻、出力データ、エラー詳細、リトライ回数）
- `listByFlowExecution()`: フロー実行IDによるステップ一覧取得

**完成度**: 完成（実装変更不要）

**注意点**: DynamoDBテーブルは別途CDKで作成する必要がある

### 1.3 Clients（外部サービス呼び出し）

#### planManagementClient.ts
**役割**: プラン管理責務のInternal関数を呼び出す
- `applyPlanToUser()`: プランをユーザに適用
  - 環境変数: `PLAN_MANAGEMENT_APPLY_FUNCTION_NAME`
  - 同一ユーザの既存プラン適用を自動終了
- `terminatePlanApplication()`: プラン適用を終了
  - 環境変数: `PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME`
  - immediate=trueの場合は即座に、falseの場合は期間終了時に終了
- `updatePlanApplicationStatus()`: プラン適用ステータスを更新
  - 環境変数: `PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME`
  - 主にバッチ処理で使用

**リトライ戦略**:
- 最大リトライ回数: 3回
- 指数バックオフ（基数: 1000ms）
- リトライ可能エラー: ServiceException, TooManyRequestsException, ThrottlingException, RequestTimeout, NetworkingError, TimeoutError

**完成度**: 完成（実装変更不要）

**連携先の準備状況**:
- PlanManagementApi Constructで3つのInternal関数が実装済み
- 関数名: `${environment}-billing-plan-internal-apply`, `${environment}-billing-plan-internal-terminate`, `${environment}-billing-plan-internal-update-status`

#### subscriptionManagementClient.ts
**役割**: サブスクリプション管理責務のInternal関数を呼び出す
- `createSubscription()`: サブスクリプションを作成
  - 環境変数: `SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME`
  - プラットフォームから受け取ったサブスクリプション情報を元にレコードを作成
- `updateSubscriptionStatus()`: サブスクリプションステータスを更新
  - 環境変数: `SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME`
  - Webhookやバッチ処理から呼び出される
- `getSubscription()`: サブスクリプション情報を取得
  - 環境変数: `SUBSCRIPTION_MANAGEMENT_GET_FUNCTION_NAME`
- `extendSubscriptionPeriod()`: サブスクリプション期限を延長
  - 環境変数: `SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME`
  - 主に更新処理で使用

**リトライ戦略**: planManagementClientと同じ

**完成度**: 完成（実装変更不要）

**連携先の準備状況**:
- SubscriptionManagementApi Constructで4つのInternal関数が実装済み
- 関数名: `${environment}-billing-subscription-internal-create`, `${environment}-billing-subscription-internal-update-status`, `${environment}-billing-subscription-internal-get`, `${environment}-billing-subscription-internal-extend-period`

#### paymentGatewayClient.ts
**役割**: 決済ゲートウェイ関数を呼び出す
- `verifyReceipt()`: レシート検証
  - 環境変数: `PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME`
  - プラットフォーム（Apple、Google）から受け取ったレシートを検証
- `updateSubscription()`: サブスクリプションを更新（プラン変更）
  - 環境変数: `PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME`
  - プロレート（日割り計算）の有無を指定可能
- `cancelSubscription()`: サブスクリプションをキャンセル
  - 環境変数: `PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME`
  - 期間終了時または即座のキャンセルを選択可能

**リトライ戦略**: planManagementClientと同じ

**完成度**: 完成（実装変更不要）

**連携先の準備状況**:
- PaymentGatewayApi Constructで3つの関数が実装済み（publicプロパティとして公開）
- 関数プロパティ: `verifyReceiptFunction`, `updateSubscriptionFunction`, `cancelSubscriptionFunction`

### 1.4 Services（ビジネスロジック）

#### flowOrchestrator.ts
**役割**: フロー実行全体を統括する中核サービス
- `startFlow()`: フロー実行を開始し、履歴レコードを作成
  - フロー実行IDを生成（UUID v4）
  - FlowExecutionRepositoryを使用してDynamoDBに記録
- `executeStep()`: ステップを実行し、進行状況を更新
  - StepExecutorを使用してステップを実行
  - 現在ステップ名と完了ステップ数を更新
- `completeFlow()`: フロー実行を正常完了として記録
  - ステータスを'completed'に更新
  - 実行時間を計算して記録
- `failFlow()`: フロー実行を失敗として記録
  - ステータスを'failed'に更新
  - エラー詳細と実行時間を記録
- `rollbackFlow()`: フロー実行をロールバック
  - RollbackHandlerを使用して完了済みステップを逆順にロールバック
  - ステータスを'rolled_back'に更新

**完成度**: 完成（実装変更不要）

**依存関係**:
- FlowExecutionRepository
- FlowStepExecutionRepository
- StepExecutor
- RollbackHandler
- flowLogger（ログ出力）

#### stepExecutor.ts
**役割**: 個別ステップの実行をリトライ付きで管理
- `execute()`: ステップを実行（リトライ付き）
  - ステップ実行履歴レコードを作成
  - executeWithRetry()を使用してリトライ戦略を適用
  - 成功時/失敗時にステップ履歴を更新
  - ログ出力（logStepStart, logStepComplete, logStepError）
- `executeWithRetry()`: リトライ戦略に従ってステップを実行（private）
  - retryStrategy.executeWithRetry()を呼び出す
  - リトライ時にステップ履歴のリトライ回数を更新
- `sanitizeData()`: データをDynamoDB保存可能な形式に変換（private）
- `extractErrorCode()`: エラーオブジェクトからエラーコードを抽出（private）

**完成度**: 完成（実装変更不要）

**依存関係**:
- FlowStepExecutionRepository
- retryStrategy（指数バックオフ）
- flowLogger（ログ出力）

#### rollbackHandler.ts
**役割**: フロー失敗時のロールバック処理を管理
- `rollback()`: 完了済みステップを逆順にロールバック
  - 各ステップのrollbackFunction()を実行
  - ロールバック処理もステップ履歴として記録（負のステップシーケンス）
  - ロールバック失敗はベストエフォート（継続）
- `rollbackStep()`: 個別ステップをロールバック（private）
  - ロールバック関数が未定義の場合はスキップ
  - ロールバック実行履歴を作成・更新

**完成度**: 完成（実装変更不要）

**依存関係**:
- FlowStepExecutionRepository
- flowLogger（ログ出力）

### 1.5 Utils（ユーティリティ）

#### retryStrategy.ts
**役割**: リトライロジックと指数バックオフを提供
- `executeWithRetry()`: リトライ付きで関数を実行
  - 最大リトライ回数まで実行を試行
  - リトライ可能エラーのみリトライ
  - 指数バックオフで待機
  - onRetryコールバックをサポート
- `calculateBackoffDelay()`: 指数バックオフの待機時間を計算
  - 基数: 2000ms、最大: 300000ms（5分）
  - 計算式: min(BASE_DELAY_MS * 2^attemptNumber, MAX_DELAY_MS)
- `isRetryableError()`: エラーがリトライ可能かを判定
  - ネットワークエラー（ECONNRESET, ETIMEDOUT等）
  - タイムアウトエラー
  - サービス一時利用不可（503）
  - スロットリングエラー
  - DynamoDB throughput exceeded
- `shouldRetry()`: 最大リトライ回数に達したかチェック

**定数**:
- `DEFAULT_MAX_RETRIES`: 3
- `BASE_DELAY_MS`: 2000
- `MAX_DELAY_MS`: 300000

**完成度**: 完成（実装変更不要）

#### flowLogger.ts
**役割**: 構造化ログ出力を提供（CloudWatch Logs統合）
- フロー関連:
  - `logFlowStart()`: フロー開始
  - `logFlowComplete()`: フロー完了
  - `logFlowError()`: フロー失敗
- ステップ関連:
  - `logStepStart()`: ステップ開始
  - `logStepComplete()`: ステップ完了
  - `logStepError()`: ステップ失敗
- ロールバック関連:
  - `logRollbackStart()`: ロールバック開始
  - `logRollbackComplete()`: ロールバック完了
  - `logRollbackStep()`: ロールバックステップ
  - `logRollbackError()`: ロールバックエラー

**ログ形式**:
- JSON構造化ログ
- フィールド: timestamp, level, flowExecutionId, message, context

**完成度**: 完成（実装変更不要）

## 2. 未実装部分の特定

### 2.1 フロー実装（flows/配下）

#### purchaseFlow.ts
**目的**: 購入フロー統括Lambda関数

**処理ステップ**:
1. ユーザ認証検証（verify_user_auth）
2. プラン存在確認（validate_plan）
3. レシート検証（verify_receipt）- PaymentGatewayClient
4. サブスクリプション作成（create_subscription）- SubscriptionManagementClient
5. プラン適用（apply_plan）- PlanManagementClient
6. 権限付与（grant_permission）- AuthorizationServiceClient（将来実装）

**ロールバック戦略**:
- Step 6失敗時: Step 5, 4をロールバック
- Step 5失敗時: Step 4をロールバック
- Step 4失敗時: ロールバック不要（サブスクリプション作成前）

**入力**: `PurchaseFlowInput`
**出力**: `PurchaseFlowOutput`

**実装優先度**: 高（最も基本的なフロー）

#### planChangeFlow.ts
**目的**: プラン変更フロー統括Lambda関数

**処理ステップ**:
1. ユーザ認証検証（verify_user_auth）
2. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
3. プラン変更タイプ判定（determine_change_type）- アップグレード/ダウングレード
4. 決済プラットフォームでサブスクリプション更新（update_platform_subscription）- PaymentGatewayClient
5. 新プラン適用（apply_new_plan）- PlanManagementClient
6. 旧プラン適用終了（terminate_old_plan）- PlanManagementClient
7. 権限更新（update_permission）- AuthorizationServiceClient（将来実装）

**ロールバック戦略**:
- Step 7失敗時: Step 6, 5, 4をロールバック
- Step 6失敗時: Step 5, 4をロールバック
- Step 5失敗時: Step 4をロールバック

**入力**: `PlanChangeFlowInput`
**出力**: `PlanChangeFlowOutput`

**実装優先度**: 中

#### cancellationFlow.ts
**目的**: 解約フロー統括Lambda関数

**処理ステップ**:
1. ユーザ認証検証（verify_user_auth）
2. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
3. 決済プラットフォームでキャンセル（cancel_platform_subscription）- PaymentGatewayClient
4. サブスクリプションステータス更新（update_subscription_status）- SubscriptionManagementClient
5. プラン適用終了スケジュール（schedule_plan_termination）- PlanManagementClient
6. 権限取消スケジュール（schedule_permission_revoke）- AuthorizationServiceClient（将来実装）

**解約タイプ**:
- `immediate`: 即座に解約（Step 5, 6を即実行）
- `at_period_end`: 期限終了時解約（Step 5, 6をスケジュール）

**ロールバック戦略**:
- Step 6失敗時: Step 5, 4, 3をロールバック
- Step 5失敗時: Step 4, 3をロールバック

**入力**: `CancellationFlowInput`
**出力**: `CancellationFlowOutput`

**実装優先度**: 中

#### webhookEventFlow.ts
**目的**: Webhookイベント処理フロー統括Lambda関数（EventBridgeルールから起動）

**処理ステップ**:
イベントタイプに応じて異なる処理フローを実行

**payment.succeeded（Stripe）/ RENEWAL（Apple）/ SUBSCRIPTION_RENEWED（Google）**:
1. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
2. サブスクリプション期限延長（extend_subscription_period）- SubscriptionManagementClient
3. プラン適用期限延長（extend_plan_application）- PlanManagementClient

**payment.failed（Stripe）/ DID_FAIL_TO_RENEW（Apple）**:
1. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
2. サブスクリプションステータス更新（update_subscription_status: past_due）- SubscriptionManagementClient
3. 通知送信（send_notification）- 将来実装

**subscription.canceled（Stripe）/ DID_CHANGE_RENEWAL_STATUS（Apple）/ SUBSCRIPTION_CANCELED（Google）**:
1. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
2. サブスクリプションステータス更新（update_subscription_status: canceled）- SubscriptionManagementClient
3. プラン適用終了（terminate_plan_application）- PlanManagementClient
4. 権限取消（revoke_permission）- AuthorizationServiceClient（将来実装）

**refund.created（Stripe）/ REFUND（Apple）/ SUBSCRIPTION_REFUNDED（Google）**:
1. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
2. サブスクリプションステータス更新（update_subscription_status: expired）- SubscriptionManagementClient
3. プラン適用即時終了（terminate_plan_application: immediate）- PlanManagementClient
4. 権限即時取消（revoke_permission）- AuthorizationServiceClient（将来実装）

**SUBSCRIPTION_EXPIRED（Google）**:
1. サブスクリプション取得（get_subscription）- SubscriptionManagementClient
2. サブスクリプションステータス更新（update_subscription_status: expired）- SubscriptionManagementClient
3. プラン適用終了（terminate_plan_application）- PlanManagementClient
4. 権限取消（revoke_permission）- AuthorizationServiceClient（将来実装）

**ロールバック戦略**: イベント処理の性質上、ロールバックは限定的（主にステータス更新を元に戻す）

**入力**: `WebhookEventFlowInput`（EventBridgeイベント）

**実装優先度**: 高（自動更新・解約処理に必須）

### 2.2 CDK Construct

#### OrchestrationApi Construct
**ファイル**: `packages/cdk/lib/construct/api/orchestration.ts`

**必要な要素**:
1. DynamoDBテーブル作成
   - `{tenant-id}-flow-execution-history`
     - PK: flowExecutionId (String)
     - SK: startedAt (Number)
     - GSI1: userId-startedAt-index (userId, startedAt)
     - GSI2: status-startedAt-index (status, startedAt)
     - GSI3: tenantId-flowType-index (tenantId, flowType)
     - TTL: ttl
   - `{tenant-id}-flow-step-execution-history`
     - PK: flowExecutionId (String)
     - SK: stepSequence (Number)
     - TTL: ttl

2. Lambda関数作成
   - `purchaseFlowFunction`: 購入フロー
   - `planChangeFlowFunction`: プラン変更フロー
   - `cancellationFlowFunction`: 解約フロー
   - `webhookEventFlowFunction`: Webhookイベント処理フロー

3. EventBridgeルール作成（Webhook用）
   - ルール名: `billing-webhook-event-rule`
   - イベントソース: `custom.billing.webhook`
   - ターゲット: `webhookEventFlowFunction`
   - イベントパターン: 各イベントタイプをフィルタ

4. IAM権限付与
   - DynamoDBテーブルへのアクセス権限
   - 他責務のInternal Lambda関数を呼び出す権限
   - EventBridgeイベントの受信権限

5. 環境変数設定
   - 各Client用の環境変数（Lambda関数名）
   - テナント情報（TENANTS_TABLE_NAME等）

6. API Gatewayエンドポイント（オプション）
   - `/billing/purchase` (POST): 購入フロー起動
   - `/billing/plan-change` (POST): プラン変更フロー起動
   - `/billing/cancel` (POST): 解約フロー起動

**実装優先度**: 高

### 2.3 Stack統合

#### BillingManagementStackへの統合
**ファイル**: `packages/cdk/lib/stacks/nested/billing-management-stack.ts`

**必要な変更**:
1. OrchestrationApi Constructのインポート
2. OrchestrationApi Constructのインスタンス化
3. 依存関係の設定
   - PlanManagementApi.internalFunctions
   - SubscriptionManagementApi.internalFunctions
   - PaymentGatewayApi（verifyReceiptFunction等）
4. 環境変数の受け渡し
   - 各Internal関数の関数名を環境変数として設定

**コード例**:
```typescript
// Orchestration API
const orchestrationApi = new OrchestrationApi(this, 'Orchestration', {
  api: billingApi,
  userPool: props.userPool,
  userPoolClient: props.userPoolClient,
  idPool: props.idPool,
  tenantManager: props.tenantManager,
  environment: props.environment,
  eventBusName: props.eventBusName,
  // Internal functions from other APIs
  planManagementInternalFunctions: planManagementApi.internalFunctions,
  subscriptionManagementInternalFunctions: subscriptionManagementApi.internalFunctions,
  paymentGatewayFunctions: {
    verifyReceipt: paymentGatewayApi.verifyReceiptFunction,
    updateSubscription: paymentGatewayApi.updateSubscriptionFunction,
    cancelSubscription: paymentGatewayApi.cancelSubscriptionFunction,
  },
});
```

**実装優先度**: 高

## 3. 連携先との接続ポイント

### 3.1 PlanManagementApi

#### Internal関数（Orchestratorから呼び出し）

**applyPlanToUser**
- **関数名**: `${environment}-billing-plan-internal-apply`
- **エントリポイント**: `./lambda/billing/plan-management/applyPlanToUser.ts`
- **呼び出し元**: PurchaseFlow（Step 5）, PlanChangeFlow（Step 5）
- **入力**: `ApplyPlanToUserParams`
  ```typescript
  {
    tenantId: string;
    userId: string;
    planId: string;
    applicationSource: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
    applicationSourceId?: string;
    validFrom: string; // ISO 8601
    validUntil?: string; // ISO 8601
  }
  ```
- **出力**: `ApplyPlanToUserResponse`
  ```typescript
  {
    applicationId: string;
    userId: string;
    planId: string;
    applicationStatus: 'active' | 'scheduled_termination' | 'expired';
    validFrom: string;
    validUntil?: string;
    previousApplicationIds: string[];
  }
  ```
- **環境変数**: `PLAN_MANAGEMENT_APPLY_FUNCTION_NAME`

**terminatePlanApplication**
- **関数名**: `${environment}-billing-plan-internal-terminate`
- **エントリポイント**: `./lambda/billing/plan-management/terminatePlanApplication.ts`
- **呼び出し元**: CancellationFlow（Step 5）, WebhookEventFlow
- **入力**: `TerminatePlanApplicationParams`
  ```typescript
  {
    tenantId: string;
    userId: string;
    planApplicationId: string;
    immediate: boolean; // true: 即座、false: 期間終了時
  }
  ```
- **出力**: `TerminatePlanApplicationResponse`
  ```typescript
  {
    success: boolean;
  }
  ```
- **環境変数**: `PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME`

**updatePlanApplicationStatus**
- **関数名**: `${environment}-billing-plan-internal-update-status`
- **エントリポイント**: `./lambda/billing/plan-management/updatePlanApplicationStatus.ts`
- **呼び出し元**: バッチ処理（将来実装）
- **入力**: `UpdatePlanApplicationStatusParams`
  ```typescript
  {
    tenantId: string;
    planApplicationId: string;
    status: 'active' | 'scheduled_termination' | 'expired';
  }
  ```
- **出力**: `UpdatePlanApplicationStatusResponse`
  ```typescript
  {
    success: boolean;
  }
  ```
- **環境変数**: `PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME`

### 3.2 SubscriptionManagementApi

#### Internal関数（Orchestratorから呼び出し）

**createSubscription**
- **関数名**: `${environment}-billing-subscription-internal-create`
- **エントリポイント**: `./lambda/billing/subscription-management/internal/createSubscription.ts`
- **呼び出し元**: PurchaseFlow（Step 4）
- **入力**: `CreateSubscriptionParams`
  ```typescript
  {
    tenantId: string;
    userId: string;
    planId: string;
    platformType: 'stripe' | 'apple' | 'google';
    platformSubscriptionId: string;
    subscriptionStatus: 'active' | 'pending_verification';
    currentPeriodStart: string; // ISO 8601
    currentPeriodEnd: string; // ISO 8601
  }
  ```
- **出力**: `CreateSubscriptionResponse`
  ```typescript
  {
    subscriptionId: string;
    status: 'active' | 'pending_verification';
  }
  ```
- **環境変数**: `SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME`

**updateSubscriptionStatus**
- **関数名**: `${environment}-billing-subscription-internal-update-status`
- **エントリポイント**: `./lambda/billing/subscription-management/internal/updateSubscriptionStatus.ts`
- **呼び出し元**: CancellationFlow（Step 4）, WebhookEventFlow
- **入力**: `UpdateSubscriptionStatusParams`
  ```typescript
  {
    tenantId: string;
    subscriptionId: string;
    newStatus: 'active' | 'past_due' | 'canceled' | 'expired';
  }
  ```
- **出力**: `UpdateSubscriptionStatusResponse`
  ```typescript
  {
    subscriptionId: string;
    previousStatus: string;
    newStatus: string;
    updatedAt: string; // ISO 8601
  }
  ```
- **環境変数**: `SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME`

**getSubscription**
- **関数名**: `${environment}-billing-subscription-internal-get`
- **エントリポイント**: `./lambda/billing/subscription-management/internal/getSubscription.ts`
- **呼び出し元**: PlanChangeFlow（Step 2）, CancellationFlow（Step 2）, WebhookEventFlow
- **入力**: `GetSubscriptionParams`
  ```typescript
  {
    tenantId: string;
    subscriptionId: string;
  }
  ```
- **出力**: Subscriptionオブジェクト（詳細はサブスクリプション管理責務の実装による）
- **環境変数**: `SUBSCRIPTION_MANAGEMENT_GET_FUNCTION_NAME`

**extendSubscriptionPeriod**
- **関数名**: `${environment}-billing-subscription-internal-extend-period`
- **エントリポイント**: `./lambda/billing/subscription-management/internal/extendSubscriptionPeriod.ts`
- **呼び出し元**: WebhookEventFlow（payment.succeeded等）
- **入力**: `ExtendSubscriptionPeriodParams`
  ```typescript
  {
    tenantId: string;
    subscriptionId: string;
    newExpiresAt: string; // ISO 8601
  }
  ```
- **出力**: `ExtendSubscriptionPeriodResponse`
  ```typescript
  {
    success: boolean;
  }
  ```
- **環境変数**: `SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME`

### 3.3 PaymentGatewayApi

#### Public関数（Orchestratorから呼び出し）

**verifyReceipt**
- **関数プロパティ**: `paymentGatewayApi.verifyReceiptFunction`
- **エントリポイント**: `./lambda/billing/payment-gateway/verification/verifyReceipt.ts`
- **呼び出し元**: PurchaseFlow（Step 3）
- **入力**: `VerifyReceiptParams`
  ```typescript
  {
    platformType?: 'stripe' | 'apple' | 'google';
    receipt: string; // Base64エンコード
    subscriptionId?: string;
  }
  ```
- **出力**: `VerifyReceiptResponse`
  ```typescript
  {
    isValid: boolean;
    platformSubscriptionId?: string;
    planId?: string;
    expiresAt?: string; // ISO 8601
  }
  ```
- **環境変数**: `PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME`

**updateSubscription**
- **関数プロパティ**: `paymentGatewayApi.updateSubscriptionFunction`
- **エントリポイント**: `./lambda/billing/payment-gateway/operations/updateSubscription.ts`
- **呼び出し元**: PlanChangeFlow（Step 4）
- **入力**: `UpdateSubscriptionParams`
  ```typescript
  {
    platform: 'stripe' | 'apple' | 'google';
    subscriptionId: string;
    newPlanId: string;
    prorate: boolean; // 日割り計算
  }
  ```
- **出力**: `UpdateSubscriptionResponse`
  ```typescript
  {
    success: boolean;
  }
  ```
- **環境変数**: `PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME`

**cancelSubscription**
- **関数プロパティ**: `paymentGatewayApi.cancelSubscriptionFunction`
- **エントリポイント**: `./lambda/billing/payment-gateway/operations/cancelSubscription.ts`
- **呼び出し元**: CancellationFlow（Step 3）
- **入力**: `CancelSubscriptionParams`
  ```typescript
  {
    platform: 'stripe' | 'apple' | 'google';
    subscriptionId: string;
    atPeriodEnd: boolean; // true: 期間終了時、false: 即座
  }
  ```
- **出力**: `CancelSubscriptionResponse`
  ```typescript
  {
    success: boolean;
  }
  ```
- **環境変数**: `PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME`

## 4. 実装順序と依存関係

### 4.1 実装フェーズ

#### フェーズ1: インフラ基盤（DynamoDB + CDK Construct）
**期間**: 1-2日
**タスク**:
1. DynamoDBテーブル定義をCDKで実装
   - `{tenant-id}-flow-execution-history`
   - `{tenant-id}-flow-step-execution-history`
2. OrchestrationApi Constructの骨格作成
   - テーブル作成ロジック
   - 共通Lambda設定
   - IAM権限設定

**成果物**:
- `packages/cdk/lib/construct/api/orchestration.ts`（基本構造）
- DynamoDBテーブル定義

**依存関係**: なし

#### フェーズ2: 購入フロー実装
**期間**: 2-3日
**タスク**:
1. `purchaseFlow.ts`の実装
   - 6ステップの実装（Step 6は将来実装のためスキップ可能）
   - StepConfig定義
   - ロールバック関数の実装
2. OrchestrationApi Constructへの統合
   - Lambda関数の追加
   - 環境変数の設定
   - API Gatewayエンドポイントの追加
3. BillingManagementStackへの統合
4. 単体テスト・統合テスト

**成果物**:
- `packages/cdk/lambda/billing/orchestration/flows/purchaseFlow.ts`
- OrchestrationApi Constructの更新
- BillingManagementStackの更新

**依存関係**: フェーズ1

#### フェーズ3: Webhookイベント処理フロー実装
**期間**: 3-4日
**タスク**:
1. `webhookEventFlow.ts`の実装
   - イベントタイプ別の処理分岐
   - 各イベントタイプのステップ実装
2. EventBridgeルールの作成
   - イベントパターンの定義
   - ターゲット設定
3. OrchestrationApi Constructへの統合
4. 単体テスト・統合テスト

**成果物**:
- `packages/cdk/lambda/billing/orchestration/flows/webhookEventFlow.ts`
- EventBridgeルール定義
- OrchestrationApi Constructの更新

**依存関係**: フェーズ2（購入フローのテスト済み実装が参考になる）

#### フェーズ4: プラン変更フロー実装
**期間**: 2-3日
**タスク**:
1. `planChangeFlow.ts`の実装
   - 7ステップの実装（Step 7は将来実装のためスキップ可能）
   - アップグレード/ダウングレードの判定ロジック
   - ロールバック関数の実装
2. OrchestrationApi Constructへの統合
3. 単体テスト・統合テスト

**成果物**:
- `packages/cdk/lambda/billing/orchestration/flows/planChangeFlow.ts`
- OrchestrationApi Constructの更新

**依存関係**: フェーズ3

#### フェーズ5: 解約フロー実装
**期間**: 2-3日
**タスク**:
1. `cancellationFlow.ts`の実装
   - 6ステップの実装（Step 6は将来実装のためスキップ可能）
   - 即時解約/期限終了時解約の処理分岐
   - ロールバック関数の実装
2. OrchestrationApi Constructへの統合
3. 単体テスト・統合テスト

**成果物**:
- `packages/cdk/lambda/billing/orchestration/flows/cancellationFlow.ts`
- OrchestrationApi Constructの更新

**依存関係**: フェーズ4

#### フェーズ6: E2Eテストとドキュメント化
**期間**: 2-3日
**タスク**:
1. E2Eテストシナリオの作成と実行
   - 購入 → プラン変更 → 解約の一連の流れ
   - Webhookイベントのシミュレーション
   - エラーハンドリング・ロールバックのテスト
2. パフォーマンステスト
   - 同時実行テスト
   - タイムアウト設定の最適化
3. ドキュメント作成
   - 運用手順書
   - トラブルシューティングガイド
   - CloudWatch Logsの監視方法

**成果物**:
- E2Eテストコード
- 運用ドキュメント

**依存関係**: フェーズ5

### 4.2 各フローの実装詳細

#### purchaseFlow.ts 実装例

```typescript
// packages/cdk/lambda/billing/orchestration/flows/purchaseFlow.ts

import { FlowOrchestrator } from '../services/flowOrchestrator';
import { PurchaseFlowInput, PurchaseFlowOutput } from '../types';
import { PlanManagementClient } from '../clients/planManagementClient';
import { SubscriptionManagementClient } from '../clients/subscriptionManagementClient';
import { PaymentGatewayClient } from '../clients/paymentGatewayClient';
import { StepConfig } from '../types';

export const handler = async (event: PurchaseFlowInput): Promise<PurchaseFlowOutput> => {
  const { tenantId, userId, planId, paymentPlatform, receiptData } = event;

  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();
  const paymentClient = new PaymentGatewayClient();

  // ステップ設定
  const steps: StepConfig[] = [
    {
      stepName: 'verify_user_auth',
      stepType: 'validation',
      executeFunction: async () => {
        // ユーザ認証検証ロジック
        // Cognitoトークンの検証等
        return { authenticated: true };
      },
      retryable: false,
      maxRetries: 0,
    },
    {
      stepName: 'validate_plan',
      stepType: 'validation',
      executeFunction: async () => {
        // プラン存在確認ロジック（RDS）
        return { planExists: true };
      },
      retryable: true,
      maxRetries: 3,
    },
    {
      stepName: 'verify_receipt',
      stepType: 'api_call',
      targetService: 'PaymentGateway',
      targetFunction: process.env.PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME,
      executeFunction: async () => {
        const result = await paymentClient.verifyReceipt({
          platformType: paymentPlatform,
          receipt: JSON.stringify(receiptData),
        });
        if (!result.isValid) {
          throw new Error('Invalid receipt');
        }
        return result;
      },
      retryable: true,
      maxRetries: 3,
    },
    {
      stepName: 'create_subscription',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME,
      executeFunction: async (inputData: any) => {
        const receiptData = inputData.previousStepResults.verify_receipt;
        const result = await subscriptionClient.createSubscription({
          tenantId,
          userId,
          planId,
          platformType: paymentPlatform,
          platformSubscriptionId: receiptData.platformSubscriptionId,
          subscriptionStatus: 'active',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: receiptData.expiresAt,
        });
        return result;
      },
      rollbackFunction: async (outputData: any) => {
        // サブスクリプション削除ロジック（将来実装）
        console.log('Rolling back create_subscription', outputData);
      },
      retryable: true,
      maxRetries: 3,
    },
    {
      stepName: 'apply_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async (inputData: any) => {
        const subscriptionData = inputData.previousStepResults.create_subscription;
        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionData.subscriptionId,
          validFrom: new Date().toISOString(),
        });
        return result;
      },
      rollbackFunction: async (outputData: any) => {
        await planClient.terminatePlanApplication({
          tenantId,
          userId,
          planApplicationId: outputData.applicationId,
          immediate: true,
        });
      },
      retryable: true,
      maxRetries: 3,
    },
    // Step 6: grant_permission は将来実装（AuthorizationServiceClient）
  ];

  // フロー実行開始
  const flowExecutionId = await orchestrator.startFlow(
    'purchase',
    userId,
    userId,
    event,
    steps.length
  );

  const completedSteps: any[] = [];

  try {
    // 各ステップを順次実行
    const previousStepResults: Record<string, any> = {};

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const result = await orchestrator.executeStep(
        flowExecutionId,
        i,
        step,
        { previousStepResults }
      );

      if (!result.success) {
        throw new Error(`Step ${step.stepName} failed`);
      }

      // 完了ステップを記録（ロールバック用）
      completedSteps.push({
        stepSequence: i,
        stepConfig: step,
        outputData: result.outputData,
      });

      // 次のステップ用に結果を保存
      previousStepResults[step.stepName] = result.outputData;
    }

    // フロー完了
    const output: PurchaseFlowOutput = {
      success: true,
      flowExecutionId,
      subscriptionId: previousStepResults.create_subscription?.subscriptionId,
      grantId: previousStepResults.grant_permission?.grantId, // 将来実装
    };

    await orchestrator.completeFlow(flowExecutionId, output);

    return output;
  } catch (error) {
    // エラー処理
    const err = error instanceof Error ? error : new Error(String(error));

    await orchestrator.failFlow(flowExecutionId, {
      errorCode: 'FLOW_EXECUTION_ERROR',
      errorMessage: err.message,
      stackTrace: err.stack,
    });

    // ロールバック実行
    if (completedSteps.length > 0) {
      try {
        await orchestrator.rollbackFlow(flowExecutionId, completedSteps);
      } catch (rollbackError) {
        console.error('Rollback failed', rollbackError);
      }
    }

    return {
      success: false,
      flowExecutionId,
      errorDetails: {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
      },
    };
  }
};
```

## 5. 実装時の注意点とリスク

### 5.1 技術的な課題

#### Lambda関数のタイムアウト
- **問題**: 複数ステップを実行するため、処理時間が長くなる可能性
- **対策**:
  - Lambda関数のタイムアウトを十分に長く設定（推奨: 5分以上）
  - 各ステップのタイムアウトを個別に監視
  - 長時間処理が必要な場合はStep Functionsへの移行を検討

#### DynamoDBテーブルのプロビジョニング
- **問題**: テナントごとにテーブルを作成するため、テーブル数が増加
- **対策**:
  - オンデマンドキャパシティモードの使用
  - テーブル作成の自動化（Tenant Manager統合）
  - TTLによる古いレコードの自動削除

#### 環境変数の管理
- **問題**: 多数のLambda関数名を環境変数として管理
- **対策**:
  - CDKでの一元管理
  - 命名規則の統一（`${environment}-billing-{service}-{action}`）
  - Systems Manager Parameter Storeの活用を検討

#### トランザクション整合性
- **問題**: 複数のAWSサービス（DynamoDB、RDS、外部API）にまたがる処理のため、厳密なトランザクションが困難
- **対策**:
  - ロールバック関数の確実な実装
  - べき等性の確保（同じ入力で複数回実行しても結果が同じ）
  - 履歴テーブルによる監査証跡の保持

#### エラーハンドリング
- **問題**: 外部API（決済プラットフォーム）のエラーが多様
- **対策**:
  - リトライ戦略の適切な設定
  - エラーコードの体系的な分類
  - Dead Letter Queueの活用

### 5.2 運用上のリスク

#### ロールバック失敗
- **リスク**: ロールバック処理自体が失敗した場合、データの不整合が発生
- **対策**:
  - ロールバック失敗をCloudWatch Alarmsで監視
  - 手動修正の手順書を用意
  - ロールバックステータスを履歴に記録

#### Webhookイベントの重複処理
- **リスク**: 決済プラットフォームから同じイベントが複数回送信される
- **対策**:
  - Payment Gateway責務で重複チェック済み（webhook-events テーブル）
  - Orchestration層でのべき等性確保

#### 大量トラフィック時のスロットリング
- **リスク**: プロモーション等で購入が集中した場合、Lambdaスロットリングが発生
- **対策**:
  - Lambda予約済み同時実行数の設定
  - SQSを使った非同期処理への移行検討
  - CloudWatch Alarmsでスロットリングを監視

#### コスト
- **リスク**: DynamoDBテーブルとLambda関数の増加によるコスト増
- **対策**:
  - TTLによる古いレコードの削除
  - Lambda関数のメモリ・タイムアウトの最適化
  - Cost Explorerでの定期的なコスト監視

### 5.3 セキュリティ上の注意点

#### IAM権限の最小権限原則
- Lambda関数には必要最小限の権限のみ付与
- テナント分離を確実に実施（テナントIDによるリソースアクセス制限）

#### 機密情報のログ出力禁止
- レシートデータ、決済情報をログに出力しない
- エラーログにも機密情報を含めない

#### EventBridgeイベントの検証
- EventBridgeから受信したイベントの署名検証（Payment Gateway責務で実施済み）

## 6. テスト戦略

### 6.1 単体テスト

#### 対象
- 各フローのステップ関数
- FlowOrchestrator, StepExecutor, RollbackHandlerのメソッド
- Client関数（モック使用）

#### ツール
- Jest
- AWS SDK Mock

#### カバレッジ目標
- コードカバレッジ: 80%以上
- 分岐カバレッジ: 70%以上

### 6.2 統合テスト

#### 対象
- フロー全体の実行（正常系）
- エラーハンドリング（異常系）
- ロールバック処理

#### テスト環境
- 専用のテストテナント
- モックStripe/Apple/Google API

#### テストケース
1. **購入フロー正常系**
   - レシート検証成功 → サブスクリプション作成 → プラン適用
2. **購入フロー異常系**
   - レシート検証失敗
   - サブスクリプション作成失敗 → ロールバック不要
   - プラン適用失敗 → サブスクリプション削除（ロールバック）
3. **プラン変更フロー正常系**
   - アップグレード（プロレートあり）
   - ダウングレード（期間終了時適用）
4. **解約フロー正常系**
   - 即時解約
   - 期限終了時解約
5. **Webhookイベント処理**
   - payment.succeeded → サブスクリプション期限延長
   - subscription.canceled → プラン適用終了
   - refund.created → 即時終了

### 6.3 E2Eテスト

#### シナリオ
1. ユーザが購入 → プラン変更（アップグレード） → プラン変更（ダウングレード） → 解約
2. ユーザが購入 → Webhook受信（payment.succeeded） → 期限延長確認
3. ユーザが購入 → Webhook受信（refund.created） → 即時終了確認

#### 検証項目
- フロー実行履歴の記録
- ステップ実行履歴の記録
- ロールバック履歴の記録
- CloudWatch Logsの出力
- RDBのデータ整合性

### 6.4 パフォーマンステスト

#### 負荷テスト
- 同時購入数: 100件/秒
- Lambda同時実行数の監視
- DynamoDBスロットリングの監視

#### タイムアウトテスト
- 各ステップのタイムアウト設定の妥当性検証
- フロー全体の実行時間測定

### 6.5 監視・アラート設定

#### CloudWatch Metrics
- Lambda実行時間
- Lambda エラー率
- DynamoDB Read/Write Capacity
- フロー実行ステータス別カウント

#### CloudWatch Alarms
- フロー実行失敗率 > 5%
- ロールバック発生率 > 1%
- Lambda関数エラー率 > 3%
- DynamoDBスロットリング発生

#### CloudWatch Logs Insights クエリ例
```
# フロー実行失敗の分析
fields @timestamp, flowExecutionId, message, context.errorMessage
| filter level = "ERROR" and message = "Flow execution failed"
| sort @timestamp desc
| limit 100

# ステップ実行時間の分析
fields @timestamp, flowExecutionId, context.stepName, context.duration
| filter message = "Step execution completed successfully"
| stats avg(context.duration), max(context.duration), count() by context.stepName
```

---

## まとめ

本実装計画書では、Orchestration層の現状分析と実装計画を整理しました。

**実装済み（完成度: 100%）**:
- 型定義（Types）
- データアクセス層（Repositories）
- 外部サービス呼び出し層（Clients）
- ビジネスロジック層（Services）
- ユーティリティ（Utils）

**未実装（実装が必要）**:
- 4つのフロー実装（purchaseFlow, planChangeFlow, cancellationFlow, webhookEventFlow）
- OrchestrationApi Construct（DynamoDBテーブル、Lambda関数、EventBridgeルール）
- BillingManagementStackへの統合

**実装期間**: 合計 12-18日（6フェーズ）

**優先順位**:
1. フェーズ1（インフラ基盤）
2. フェーズ2（購入フロー）
3. フェーズ3（Webhookイベント処理）
4. フェーズ4（プラン変更フロー）
5. フェーズ5（解約フロー）
6. フェーズ6（E2Eテスト）

既存の実装は非常に高品質で、フロー統括の基盤としてそのまま利用可能です。残りの実装も、既存のパターンに従うことで、一貫性のある実装が可能です。
