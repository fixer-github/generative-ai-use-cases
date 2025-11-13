# Plan Management実装調査結果

**調査日**: 2025-11-13
**調査対象**: packages/cdk/lambda/billing/admin/plan-management/ および関連リポジトリ
**参照仕様**: `購入・変更・解約などの複数ステップの処理を統括する/技術実装詳細.md`

---

## 1. エグゼクティブサマリー

Plan Management責務は**管理者向けのプランCRUD機能**として部分的に実装されているが、**統括責務(Orchestrator)が必要とするプラン適用API**は未実装である。

### 実装状況の概要

| カテゴリ | 実装状況 | 備考 |
|---------|---------|------|
| 管理者向けプラン管理API | ✅ 実装済み | 7つのLambda関数 |
| ユーザープラン適用リポジトリ | ✅ 実装済み | UserPlanApplicationRepository完備 |
| プラン適用API (統括責務用) | ❌ 未実装 | applyPlanToUser等が存在しない |
| デフォルトプラン遷移機構 | ❌ 未実装 | 自動遷移処理なし |
| scheduled_termination期限チェック | ❌ 未実装 | バッチ処理なし |

---

## 2. 実装済み機能

### 2.1 管理者向けプラン管理API (7 Lambda関数)

**実装場所**: `packages/cdk/lambda/billing/admin/plan-management/`

| Lambda関数 | エンドポイント | 機能 |
|-----------|--------------|------|
| listPlans | GET /admin/billing/plans | プラン一覧取得 (検索・フィルタ・ソート対応) |
| getPlan | GET /admin/billing/plans/{plan_id} | プラン詳細取得 |
| createPlan | POST /admin/billing/plans | プラン作成 |
| updatePlanStatus | PATCH /admin/billing/plans/{plan_id}/status | プランステータス変更 |
| getPlanHistory | GET /admin/billing/plans/{plan_id}/history | プラン変更履歴取得 |
| getPlanSubscriptions | GET /admin/billing/plans/{plan_id}/subscriptions | プラン契約状況取得 |
| checkPlanName | GET /admin/billing/plans/check-name | 内部名称の重複チェック |

**CDK構成**: `packages/cdk/lib/construct/api/plan-management.ts`

### 2.2 リポジトリ層の実装

**実装場所**: `packages/cdk/lambda/repositories/`

#### PlanRepository (`planRepository.ts`)
プランマスタデータのCRUD操作を提供。

**主要メソッド**:
- `create()`: プラン作成
- `findById()`: プランID検索
- `findByInternalName()`: 内部名称検索
- `findByPlatformProductId()`: プラットフォーム商品ID検索
- `findAll()`: 一覧取得 (フィルタ・ソート対応)
- `update()`: プラン更新
- `deprecate()`: プラン廃止 (論理削除)

#### UserPlanApplicationRepository (`userPlanApplicationRepository.ts`)
ユーザープラン適用のCRUD操作を提供。

**主要メソッド**:
- `create()`: プラン適用作成
- `findById()`: 適用ID検索
- `findByUserId()`: ユーザーIDで全適用取得
- `findActiveByUserId()`: ユーザーIDで有効な適用のみ取得
- `findByApplicationSourceId()`: 適用ソースIDで検索
- `findExpiringSoon()`: 期限切れ間近の適用取得
- `findScheduledTermination()`: scheduled_termination状態の適用取得
- `update()`: 適用更新
- `scheduleTermination()`: scheduled_terminationへの状態変更
- `expire()`: expired状態への変更
- `extendValidity()`: 有効期限延長
- `findSubscriptionApplicationByUserId()`: サブスクリプション経由の適用取得

### 2.3 データモデル定義

**実装場所**: `packages/cdk/lambda/repositories/types.ts`

#### UserPlanApplication型
```typescript
export interface UserPlanApplication {
  application_id: string;
  user_id: string;
  plan_id: string;
  application_source: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
  application_source_id?: string;
  application_status: 'active' | 'scheduled_termination' | 'expired';
  valid_from: Date;
  valid_until?: Date;
  created_at: Date;
  updated_at: Date;
}
```

**評価**:
- ✅ scheduled_termination状態をサポート
- ✅ 適用ソース(subscription/default/trial/manual/campaign)の記録をサポート
- ✅ 有効期限(valid_until)の管理をサポート

---

## 3. 未実装機能 (統括責務が必要とするもの)

### 3.1 プラン適用API (統括責務用Lambda関数)

**期待される実装場所**: `packages/cdk/lambda/billing/plan-management/` (新規ディレクトリ)

**必要なLambda関数** (技術実装詳細.mdより):

#### (1) applyPlanToUser
**責務**: ユーザーへのプラン適用
**入力パラメータ**:
```typescript
{
  userId: string;
  planId: string;
  applicationSource: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
  applicationSourceId?: string;
  validFrom: Date;
  validUntil?: Date;
}
```
**処理内容**:
1. プランの存在確認
2. 既存の有効なプラン適用があれば終了処理
3. UserPlanApplicationRepository.create()でプラン適用作成
4. Authorization Service呼び出しで権限付与 (OpenFGA + カウント機構)
5. 結果を返却

**実装状況**: ❌ 未実装

#### (2) terminatePlanApplication
**責務**: プラン適用終了
**入力パラメータ**:
```typescript
{
  userId: string;
  applicationSourceId: string; // サブスクリプションIDなど
}
```
**処理内容**:
1. applicationSourceIdでプラン適用を検索
2. application_statusをexpiredに変更
3. Authorization Service呼び出しで権限剥奪
4. 結果を返却

**実装状況**: ❌ 未実装

#### (3) updatePlanApplicationStatus
**責務**: プラン適用状態更新
**入力パラメータ**:
```typescript
{
  applicationId: string;
  newStatus: 'active' | 'scheduled_termination' | 'expired';
  validUntil?: Date; // 有効期限延長時
}
```
**処理内容**:
1. applicationIdでプラン適用を検索
2. ステータスまたは有効期限を更新
3. scheduled_terminationの場合は権限は剥奪しない
4. expiredの場合は権限を剥奪
5. 結果を返却

**実装状況**: ❌ 未実装

### 3.2 デフォルトプランへの遷移機構

**期待される実装**:
- サブスクリプション終了時、トライアル期限切れ時などに、自動的にデフォルトプラン(例: Freeプラン)を適用する機能
- 統括責務のWebhookイベントハンドラーから呼び出される

**技術実装詳細.mdの記述** (行277-279):
```
7. **デフォルトプランへの遷移** (処理時間: ~300ms)
   - Plan Management Serviceでデフォルトプラン（Freeプランなど）を適用
```

**現状の実装**: ❌ 未実装
- デフォルトプランの定義機構なし (RDB上のフラグなど)
- デフォルトプラン自動適用のロジックなし

### 3.3 scheduled_termination期限切れチェック処理

**期待される実装**:
- EventBridge Schedulerで定期実行 (例: 1時間ごと)
- scheduled_termination状態かつvalid_untilが現在時刻を過ぎたプラン適用を検出
- 権限を剥奪し、デフォルトプランに遷移

**技術実装詳細.mdの記述** (行1083-1089):
```
### 13.3 バッチ処理との連携

#### 定期実行が必要な処理
- 期限終了時解約（scheduled_termination）のプラン適用を定期的にチェックし、
  期限到達時に権限を剥奪してデフォルトプランに遷移
```

**現状の実装**: ❌ 未実装
- バッチ処理用Lambda関数なし
- EventBridge Scheduler設定なし

**リポジトリ層の準備状況**: ✅ 準備済み
- `UserPlanApplicationRepository.findExpiringSoon(Date)`: 期限切れ間近取得メソッド実装済み
- `UserPlanApplicationRepository.expire(applicationId)`: expired状態への変更メソッド実装済み

### 3.4 統括責務のサービス層から呼び出すためのインターフェース

**技術実装詳細.mdの記述** (行779-786):
```typescript
##### planManagementService.ts
Plan Management責務のLambda関数を呼び出すサービスです。

**提供するメソッド**:
- `getPlan(planId)`: プラン取得
- `applyPlanToUser(params)`: プラン適用
- `terminatePlanApplication(params)`: プラン適用終了
- `updatePlanApplicationStatus(params)`: プラン適用状態更新
```

**現状の実装**: ❌ 未実装
- 統括責務自体が未実装のため、planManagementService.tsも存在しない

---

## 4. 部分的な実装例

### 4.1 approveSubscription.ts での限定的なプラン適用

**実装場所**: `packages/cdk/lambda/billing/admin/subscription-management/approveSubscription.ts`

**該当コード** (行138-146):
```typescript
// 2. ユーザプラン適用レコードを作成
const userPlanApplication = await userPlanApplicationRepository.create({
  user_id: subscription.user_id,
  plan_id: subscription.plan_id,
  application_source: 'subscription',
  application_source_id: subscription.subscription_id,
  application_status: 'active',
  valid_from: subscription.current_period_start,
  valid_until: subscription.current_period_end,
});
```

**評価**:
- ✅ UserPlanApplicationRepository.create()を使用してプラン適用を作成
- ❌ 権限付与処理なし (TODO行148-152でコメントのみ)
- ❌ 既存プラン適用の終了処理なし
- ❌ 汎用的なAPIではない (サブスクリプション承認専用)

**不足している処理** (TODO行148-152):
```typescript
// TODO: 以下の処理を実装
// 3. OpenFGAに権限を登録
// 4. 利用回数カウンターを初期化
// 5. ユーザに通知を送信
// 6. 操作を監査ログに記録
```

---

## 5. scheduled_termination状態のサポート状況

### 5.1 データモデル
- ✅ UserPlanApplication型でscheduled_termination状態を定義済み
- ✅ valid_untilフィールドで有効期限を記録可能

### 5.2 リポジトリ層
- ✅ `scheduleTermination(applicationId)`: scheduled_terminationへの状態変更メソッド実装済み
- ✅ `findScheduledTermination()`: scheduled_termination状態の適用取得メソッド実装済み
- ✅ `findExpiringSoon(Date)`: 期限切れ間近の適用取得メソッド実装済み

### 5.3 ビジネスロジック層
- ❌ scheduled_termination状態への遷移APIなし
- ❌ scheduled_termination期限到達時の自動処理なし

### 5.4 統括責務での利用想定

**技術実装詳細.mdの記述** (行292-294):
```
5. **プラン適用状態更新** (処理時間: ~200ms)
   - Plan Management Serviceでscheduled_terminationにマーク
   - 有効期限はそのまま維持
   - 権限は剥奪しない
```

**Webhookイベント処理での利用想定** (行351-353):
```
4. **プラン適用状態の確認** (処理時間: ~150ms)
   - Plan Management Serviceで現在の状態を取得
   - scheduled_terminationの場合: 延長しない（予定通り終了）
   - activeの場合: 有効期限を延長
```

---

## 6. デフォルトプランの定義と管理

### 6.1 現状のプランステータス定義

**実装場所**: `packages/cdk/lambda/repositories/types.ts`

```typescript
export interface Plan {
  // ...
  status: 'active' | 'closed_to_new' | 'deprecated';
  // ...
}
```

**評価**:
- ❌ デフォルトプランを識別するフラグなし
- ❌ テナントごとのデフォルトプラン設定機構なし

### 6.2 デフォルトプラン取得の想定実装

**必要な機能**:
1. テナント設定テーブルにdefault_plan_idカラムを追加
2. Plan Management APIでデフォルトプラン取得メソッドを提供
   - `getDefaultPlan(tenantId): Promise<Plan>`
3. デフォルトプラン適用時にapplication_source='default'で記録

**現状**: ❌ 未実装

---

## 7. 統括責務実装のための必須修正事項まとめ

### 7.1 プラン適用API (高優先度)

#### 修正1: applyPlanToUserの実装
- **実装場所**: `packages/cdk/lambda/billing/plan-management/applyPlanToUser.ts` (新規)
- **処理内容**:
  1. プランの存在確認 (PlanRepository.findById)
  2. 既存の有効なプラン適用を終了 (UserPlanApplicationRepository.findActiveByUserId + expire)
  3. 新しいプラン適用を作成 (UserPlanApplicationRepository.create)
  4. Authorization Service呼び出しで権限付与 (OpenFGA + カウント機構) ※統括責務側で実施
  5. 結果を返却
- **入力**: `{ userId, planId, applicationSource, applicationSourceId?, validFrom, validUntil? }`
- **出力**: `{ applicationId, userId, planId, applicationStatus, validFrom, validUntil }`
- **Lambda名**: `{environment}-billing-plan-management-apply-plan`
- **タイムアウト**: 30秒
- **メモリ**: 512MB

#### 修正2: terminatePlanApplicationの実装
- **実装場所**: `packages/cdk/lambda/billing/plan-management/terminatePlanApplication.ts` (新規)
- **処理内容**:
  1. applicationSourceIdでプラン適用を検索 (UserPlanApplicationRepository.findByApplicationSourceId)
  2. application_statusをexpiredに変更 (UserPlanApplicationRepository.expire)
  3. Authorization Service呼び出しで権限剥奪 ※統括責務側で実施
  4. 結果を返却
- **入力**: `{ userId, applicationSourceId }`
- **出力**: `{ applicationId, previousStatus: 'active' | 'scheduled_termination', newStatus: 'expired' }`
- **Lambda名**: `{environment}-billing-plan-management-terminate-application`
- **タイムアウト**: 30秒
- **メモリ**: 512MB

#### 修正3: updatePlanApplicationStatusの実装
- **実装場所**: `packages/cdk/lambda/billing/plan-management/updatePlanApplicationStatus.ts` (新規)
- **処理内容**:
  1. applicationIdでプラン適用を検索 (UserPlanApplicationRepository.findById)
  2. ステータスまたは有効期限を更新 (UserPlanApplicationRepository.update)
  3. scheduled_terminationの場合は権限は剥奪しない
  4. expiredの場合は権限を剥奪 ※統括責務側で実施
  5. 結果を返却
- **入力**: `{ applicationId, newStatus?, validUntil? }`
- **出力**: `{ applicationId, previousStatus, newStatus, validUntil }`
- **Lambda名**: `{environment}-billing-plan-management-update-status`
- **タイムアウト**: 30秒
- **メモリ**: 512MB

### 7.2 デフォルトプラン遷移機構 (中優先度)

#### 修正4: デフォルトプランの定義
- **実装場所**: テナント設定テーブル (既存のRDBスキーマ拡張)
- **必要なカラム**:
  - `default_plan_id`: デフォルトプランID (plans.plan_idへの外部キー)
- **初期値**: 管理者がプラン作成後に設定

#### 修正5: デフォルトプラン取得API
- **実装場所**: `packages/cdk/lambda/billing/plan-management/getDefaultPlan.ts` (新規)
- **処理内容**:
  1. テナント設定からdefault_plan_idを取得
  2. PlanRepository.findById()でプラン情報を取得
  3. 結果を返却
- **入力**: `{ tenantId }`
- **出力**: `{ planId, internalName, displayName, permissions }`
- **Lambda名**: `{environment}-billing-plan-management-get-default-plan`
- **タイムアウト**: 30秒
- **メモリ**: 512MB

#### 修正6: デフォルトプラン適用処理
- **実装場所**: 統括責務のWebhookイベントハンドラー内で実施
- **処理フロー**:
  1. getDefaultPlan(tenantId)でデフォルトプランを取得
  2. applyPlanToUser({ userId, planId: defaultPlanId, applicationSource: 'default', validFrom: now })
  3. ※有効期限(validUntil)は設定しない (無期限)

### 7.3 scheduled_termination期限切れチェック (中優先度)

#### 修正7: バッチ処理Lambda関数
- **実装場所**: `packages/cdk/lambda/billing/plan-management/checkExpiringApplications.ts` (新規)
- **処理内容**:
  1. UserPlanApplicationRepository.findExpiringSoon(now)で期限切れ間近の適用を取得
  2. 各適用に対して:
     - UserPlanApplicationRepository.expire(applicationId)で状態をexpiredに変更
     - Authorization Service呼び出しで権限剥奪
     - デフォルトプラン適用 (getDefaultPlan + applyPlanToUser)
  3. 処理件数をCloudWatch Metricsに記録
- **トリガー**: EventBridge Scheduler (1時間ごと)
- **Lambda名**: `{environment}-billing-plan-management-check-expiring`
- **タイムアウト**: 300秒 (5分)
- **メモリ**: 512MB

#### 修正8: EventBridge Scheduler設定
- **実装場所**: `packages/cdk/lib/construct/api/plan-management.ts` (既存ファイル修正)
- **スケジュール**: `rate(1 hour)`
- **ターゲット**: checkExpiringApplicationsLambda関数

### 7.4 CDK構成の追加 (高優先度)

#### 修正9: plan-management.tsの拡張
- **実装場所**: `packages/cdk/lib/construct/api/plan-management.ts` (既存ファイル修正)
- **追加内容**:
  1. 3つのLambda関数追加 (applyPlanToUser, terminatePlanApplication, updatePlanApplicationStatus)
  2. バッチ処理Lambda関数追加 (checkExpiringApplications)
  3. EventBridge Scheduler追加
  4. Lambda間呼び出し権限追加 (統括責務から呼び出される)

#### 修正10: Lambda間呼び出し権限の設定
- **実装場所**: `packages/cdk/lib/construct/api/plan-management.ts` (既存ファイル修正)
- **必要な権限**:
  - 統括責務のLambda関数に、Plan Management Lambda関数の `lambda:InvokeFunction` 権限を付与
  - リソース指定: `arn:aws:lambda:*:*:function:{environment}-billing-plan-management-*`

### 7.5 データベーススキーマの拡張 (低優先度)

#### 修正11: テナント設定テーブルの拡張
- **実装場所**: RDBマイグレーションスクリプト
- **追加カラム**:
  ```sql
  ALTER TABLE tenants ADD COLUMN default_plan_id VARCHAR(255);
  ALTER TABLE tenants ADD CONSTRAINT fk_default_plan
    FOREIGN KEY (default_plan_id) REFERENCES plans(plan_id);
  ```

---

## 8. 実装優先順位と依存関係

### Phase 1: プラン適用API (統括責務の前提)
1. ✅ UserPlanApplicationRepository (実装済み)
2. 修正1: applyPlanToUserの実装
3. 修正2: terminatePlanApplicationの実装
4. 修正3: updatePlanApplicationStatusの実装
5. 修正9: plan-management.tsの拡張
6. 修正10: Lambda間呼び出し権限の設定

### Phase 2: デフォルトプラン機構
1. 修正4: デフォルトプランの定義 (テナント設定拡張)
2. 修正11: テナント設定テーブルの拡張 (RDBマイグレーション)
3. 修正5: デフォルトプラン取得APIの実装
4. 修正6: デフォルトプラン適用処理 (統括責務側で実施)

### Phase 3: scheduled_termination期限チェック
1. 修正7: バッチ処理Lambda関数の実装
2. 修正8: EventBridge Scheduler設定

---

## 9. 統括責務実装のブロッカー

### 9.1 必須のブロッカー
1. **プラン適用API未実装** (修正1-3)
   - 統括責務のpurchaseFlow、changePlanFlow、cancelFlowで必須
   - 実装なしでは統括責務が機能しない

### 9.2 推奨のブロッカー
2. **デフォルトプラン機構未実装** (修正4-6)
   - cancelFlow、Webhookイベントハンドラー(subscription.canceled, payment.refunded)で必須
   - 実装なしでは解約・返金時にプラン未適用状態になる

### 9.3 後回し可能な項目
3. **scheduled_termination期限チェック未実装** (修正7-8)
   - at_period_endでのキャンセル機能で必要
   - 実装なしでは期限到達後も権限が残り続ける
   - バッチ処理のため、統括責務の実装後に追加可能

---

## 10. その他の発見事項

### 10.1 権限管理との連携が未実装
- approveSubscription.ts のTODOコメント (行148-152) で明示的に「OpenFGAに権限を登録」が未実装
- 統括責務の技術実装詳細では「Authorization Service」を呼び出す想定だが、このサービス自体が未実装の可能性あり

### 10.2 通知サービスとの連携が未実装
- approveSubscription.ts のレスポンス (行164) で `notification_sent: false` を固定値で返却
- 統括責務の技術実装詳細 (行1069-1078) でも通知サービスは「今後実装予定」

### 10.3 監査ログが未実装
- approveSubscription.ts のTODO (行154) で「操作を監査ログに記録」
- updatePlanStatus.ts のTODO (行241-242) で「監査ログの記録」「プラン変更履歴テーブルへの記録」

---

## 11. 推奨される実装アプローチ

### アプローチA: Plan Management責務の完全実装
1. 修正1-3: プラン適用APIを実装
2. 修正4-6: デフォルトプラン機構を実装
3. 修正7-8: scheduled_termination期限チェックを実装
4. 統括責務実装に進む

**メリット**:
- Plan Management責務が完全に自己完結する
- 統括責務の実装がシンプルになる

**デメリット**:
- 実装工数が大きい (5-7日)

### アプローチB: 統括責務に一部機能を実装
1. 修正1-3のみ実装 (プラン適用API)
2. デフォルトプラン遷移は統括責務内で直接UserPlanApplicationRepositoryを呼び出し
3. scheduled_termination期限チェックは統括責務のバッチ処理として実装

**メリット**:
- 実装工数が小さい (2-3日)
- 統括責務の実装を早く開始できる

**デメリット**:
- 統括責務がPlan Managementの内部実装に依存する
- 責務の境界が不明確になる

### 推奨: アプローチA
- 技術実装詳細.mdの設計思想 (「Lambda-to-Lambda呼び出しパターン」「責務の分離」) に沿う
- 長期的な保守性・拡張性が高い

---

## 12. 次のアクション

### 即座に必要なアクション
1. Plan Management責務のプラン適用API実装 (修正1-3, 9-10)
2. デフォルトプラン機構の実装 (修正4-6, 11)

### 統括責務実装後に追加
3. scheduled_termination期限チェック実装 (修正7-8)

### 並行して進められるアクション
4. 権限管理サービス (Authorization Service) の実装状況確認
5. 通知サービスの実装状況確認
6. 監査ログ機構の設計・実装

---

## 13. 参考情報

### 13.1 関連ファイル
- **技術実装詳細**: `docs/課金・プランの仕様/購入・変更・解約などの複数ステップの処理を統括する/技術実装詳細.md`
- **リポジトリ実装**: `packages/cdk/lambda/repositories/userPlanApplicationRepository.ts`
- **管理者向けAPI**: `packages/cdk/lambda/billing/admin/plan-management/`
- **CDK構成**: `packages/cdk/lib/construct/api/plan-management.ts`

### 13.2 実装時の参考コード
- **プラン適用の限定的な実装例**: `packages/cdk/lambda/billing/admin/subscription-management/approveSubscription.ts` (行138-146)
- **リポジトリメソッドの活用例**: `packages/cdk/lambda/billing/admin/plan-management/updatePlanStatus.ts` (行199-202)

---

**調査完了日**: 2025-11-13
**調査者**: Claude (AI Assistant)
