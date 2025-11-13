# RDBスキーマ実装調査結果

**調査日**: 2025-11-13
**調査対象**: プラン・サブスクリプション・ユーザプラン適用テーブルのRDB実装状況

---

## 1. テーブル構成

### 実装状況サマリー

| テーブル名                    | 実装済み | マイグレーションファイル                                  |
| ----------------------------- | -------- | --------------------------------------------------------- |
| schema_migrations             | ✅       | `000_create_schema_migrations_table.sql`                  |
| plans                         | ✅       | `001_create_plans_table.sql`                              |
| subscriptions                 | ✅       | `002_create_subscriptions_table.sql`                      |
| user_plan_applications        | ✅       | `003_create_user_plan_applications_table.sql`             |
| flow_execution_logs           | ❌       | 未実装（統括責務実装時に必要）                            |

### マイグレーションファイルの場所

```
packages/cdk/database/migrations/
├── 000_create_schema_migrations_table.sql
├── 001_create_plans_table.sql
├── 002_create_subscriptions_table.sql
└── 003_create_user_plan_applications_table.sql
```

### マイグレーション実行の仕組み

- **実行コード**: `/packages/cdk/lambda/database-migration/migrationRunner.ts`
- **実行Lambda**: `/packages/cdk/lambda/database-migration/applyMigrations.ts`
- **実行方式**: 番号順（000 → 001 → 002 → 003）に自動実行
- **適用管理**: `schema_migrations` テーブルに適用済みバージョンを記録
- **トランザクション**: 各マイグレーションはトランザクション単位で実行（失敗時はロールバック）

---

## 2. スキーマ詳細

### 2.1 plansテーブル（実装済み）

#### 概要
システムで提供される全てのプラン定義を保存するテーブル。

#### カラム構成

| カラム名            | 型           | 制約                                                | 説明                                                             |
| ------------------- | ------------ | --------------------------------------------------- | ---------------------------------------------------------------- |
| plan_id             | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid()              | プランを一意に識別するID                                         |
| internal_name       | VARCHAR(255) | NOT NULL, UNIQUE                                    | システム管理者用の判別名（例: 'standard_2025_jan_stripe'）       |
| display_name        | VARCHAR(255) | NOT NULL                                            | ユーザー表示名（例: 'Standardプラン'）                           |
| description         | TEXT         | NULL                                                | プランの詳しい説明文                                             |
| platform_type       | VARCHAR(50)  | NOT NULL, CHECK IN ('stripe', 'apple', 'google', 'internal') | プラットフォーム種別                                             |
| platform_product_id | VARCHAR(255) | NULL                                                | 課金プラットフォーム側の商品ID                                   |
| permissions         | JSONB        | NOT NULL                                            | 機能と利用回数制限を定義したJSON                                 |
| status              | VARCHAR(50)  | NOT NULL, DEFAULT 'active', CHECK IN ('active', 'closed_to_new', 'deprecated') | プランの状態                                                     |
| created_at          | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                 | 作成日時                                                         |
| updated_at          | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                 | 更新日時（トリガーで自動更新）                                   |

#### インデックス

- `idx_plans_internal_name`: internal_name（検索用）
- `idx_plans_platform_status`: (platform_type, status)（プラットフォーム別の提供中プラン一覧取得用）
- `idx_plans_platform_product_id`: platform_product_id（Webhookイベント処理でプラン特定用）

#### トリガー

- `update_plans_updated_at`: 更新時にupdated_atを自動更新

#### 技術実装詳細との整合性

✅ **完全一致**: 定義されているカラムと制約が技術実装詳細の要件を満たしています。

---

### 2.2 subscriptionsテーブル（実装済み）

#### 概要
ユーザーの課金プラットフォーム経由のサブスクリプション契約情報を保存するテーブル。

#### カラム構成

| カラム名                 | 型           | 制約                                                                                     | 説明                                                     |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| subscription_id          | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid()                                                   | サブスクリプションを一意に識別するID                     |
| user_id                  | VARCHAR(255) | NOT NULL                                                                                 | サブスクリプションを契約しているユーザーID               |
| plan_id                  | UUID         | NOT NULL, FOREIGN KEY → plans(plan_id)                                                   | 契約されているプランのID                                 |
| platform_type            | VARCHAR(50)  | NOT NULL, CHECK IN ('stripe', 'apple', 'google')                                         | プラットフォーム種別                                     |
| platform_subscription_id | VARCHAR(255) | NOT NULL, UNIQUE                                                                         | 課金プラットフォーム側のサブスクリプションID             |
| subscription_status      | VARCHAR(50)  | NOT NULL, CHECK IN ('active', 'pending_verification', 'past_due', 'canceled', 'expired') | サブスクリプションの現在の状態                           |
| current_period_start     | TIMESTAMPTZ  | NOT NULL                                                                                 | 現在の期間の開始日時                                     |
| current_period_end       | TIMESTAMPTZ  | NOT NULL                                                                                 | 現在の期間の終了日時                                     |
| cancel_at_period_end     | BOOLEAN      | NOT NULL, DEFAULT false                                                                  | 期限終了時にキャンセルするかどうか                       |
| created_at               | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                                                      | 作成日時                                                 |
| updated_at               | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                                                      | 更新日時（トリガーで自動更新）                           |

#### インデックス

- `idx_subscriptions_user_id`: user_id（特定ユーザーのサブスクリプション取得用）
- `idx_subscriptions_platform_subscription_id`: platform_subscription_id（Webhookイベント処理用）
- `idx_subscriptions_status`: subscription_status（特定状態のサブスクリプション一覧取得用）
- `idx_subscriptions_period_end`: current_period_end（期限切れチェックバッチ処理用）
- `idx_subscriptions_user_status`: (user_id, subscription_status)（頻繁に使われるクエリパターン）

#### 外部キー制約

- `fk_subscriptions_plan`: plan_id → plans(plan_id) ON DELETE RESTRICT ON UPDATE CASCADE

#### トリガー

- `update_subscriptions_updated_at`: 更新時にupdated_atを自動更新

#### 技術実装詳細との整合性

✅ **完全一致**: 統括責務が期待するサブスクリプション状態（active, pending_verification, past_due, canceled, expired）をすべてサポート。

---

### 2.3 user_plan_applicationsテーブル（実装済み）

#### 概要
各ユーザーに現在どのプランが適用されているかを記録するテーブル。

#### カラム構成

| カラム名            | 型           | 制約                                                                               | 説明                                           |
| ------------------- | ------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| application_id      | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid()                                             | プラン適用を一意に識別するID                   |
| user_id             | VARCHAR(255) | NOT NULL                                                                           | プランが適用されているユーザーID               |
| plan_id             | UUID         | NOT NULL, FOREIGN KEY → plans(plan_id)                                             | ユーザーに適用されているプランID               |
| application_source  | VARCHAR(50)  | NOT NULL, CHECK IN ('subscription', 'default', 'trial', 'campaign', 'manual')      | プラン適用ソース                               |
| application_source_id | VARCHAR(255) | NULL                                                                               | 適用ソースに関連するID（subscription IDなど）   |
| application_status  | VARCHAR(50)  | NOT NULL, CHECK IN ('active', 'scheduled_termination', 'expired')                  | プラン適用の現在の状態                         |
| valid_from          | TIMESTAMPTZ  | NOT NULL                                                                           | 有効期間開始日時                               |
| valid_until         | TIMESTAMPTZ  | NULL                                                                               | 有効期間終了日時（無期限の場合はNULL）         |
| created_at          | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                                                | 作成日時                                       |
| updated_at          | TIMESTAMPTZ  | NOT NULL, DEFAULT CURRENT_TIMESTAMP                                                | 更新日時（トリガーで自動更新）                 |

#### インデックス

- `idx_user_plan_applications_user_status`: (user_id, application_status)（最頻出クエリ: 特定ユーザーの有効なプラン適用取得用）
- `idx_user_plan_applications_source_id`: application_source_id（サブスクリプションIDからプラン適用を特定）
- `idx_user_plan_applications_valid_until_status`: (valid_until, application_status)（期限切れチェックバッチ処理用）
- `idx_user_plan_applications_user_id`: user_id（ユーザーの全プラン適用履歴取得用）

#### 外部キー制約

- `fk_user_plan_applications_plan`: plan_id → plans(plan_id) ON DELETE RESTRICT ON UPDATE CASCADE

#### トリガー

- `update_user_plan_applications_updated_at`: 更新時にupdated_atを自動更新

#### 技術実装詳細との整合性

✅ **完全一致**: 統括責務が必要とする以下をすべてサポート:
- 適用ソース（subscription/default/trial/manual/campaign）の記録
- scheduled_termination状態のサポート（期限終了時解約用）
- 有効期限の記録（valid_from/valid_until）

---

### 2.4 flow_execution_logsテーブル（未実装）

#### 概要
統括責務が各フロー（購入、変更、解約、Webhookイベント処理）の実行状態とステップごとの結果を記録するためのテーブル。

#### 技術実装詳細での定義

技術実装詳細.md（6.2節）で以下のスキーマが定義されています:

```sql
CREATE TABLE flow_execution_logs (
  flow_execution_id UUID PRIMARY KEY,
  flow_type VARCHAR(50) NOT NULL,  -- 'purchase' | 'change_plan' | 'cancel' | 'webhook_event'
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,  -- 'processing' | 'completed' | 'failed'
  input_params JSONB NOT NULL,
  error_info JSONB,
  step_results JSONB,  -- 各ステップの実行結果を配列で記録
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,

  INDEX idx_user_id_created_at (user_id, created_at),
  INDEX idx_tenant_id_created_at (tenant_id, created_at),
  INDEX idx_status_created_at (status, created_at)
);
```

#### 実装状況

❌ **未実装**: マイグレーションファイルが存在しません。

#### 必要性

統括責務の実装には**必須**です。理由:
1. フロー実行の成功・失敗状態を追跡
2. 部分失敗時のロールバックやリトライの判断に使用
3. デバッグと監査ログとして機能
4. パフォーマンス分析（各ステップの実行時間記録）

---

## 3. データモデルの整合性チェック

### 3.1 技術実装詳細との比較

| 項目                                        | 期待される仕様                                                      | 実装状況 | 評価 |
| ------------------------------------------- | ------------------------------------------------------------------- | -------- | ---- |
| プランテーブルの存在                        | plans                                                               | ✅       | OK   |
| プラン状態の管理                            | active / closed_to_new / deprecated                                 | ✅       | OK   |
| プラットフォーム種別の管理                  | stripe / apple / google / internal                                  | ✅       | OK   |
| サブスクリプションテーブルの存在            | subscriptions                                                       | ✅       | OK   |
| サブスクリプション状態の管理                | active / pending_verification / past_due / canceled / expired       | ✅       | OK   |
| ユーザープラン適用テーブルの存在            | user_plan_applications                                              | ✅       | OK   |
| プラン適用ソースの記録                      | subscription / default / trial / campaign / manual                  | ✅       | OK   |
| scheduled_termination状態のサポート         | application_status: 'scheduled_termination'                         | ✅       | OK   |
| 適用ソースIDの記録                          | application_source_id（subscription IDなど）                        | ✅       | OK   |
| フロー実行ログテーブルの存在                | flow_execution_logs                                                 | ❌       | NG   |
| 外部キー制約の設定                          | subscriptions → plans, user_plan_applications → plans               | ✅       | OK   |
| インデックスの最適化                        | 頻繁に使われるクエリパターン用のインデックス                        | ✅       | OK   |
| 更新日時の自動更新                          | TRIGGERによるupdated_atの自動更新                                   | ✅       | OK   |

### 3.2 統括責務イベント形式定義との整合性

統括責務が必要とするイベント形式定義.md（2025-11-13）で期待されるデータ項目との整合性:

| イベント形式で必須の項目  | 格納先テーブル・カラム                               | 実装状況 | 評価 |
| ------------------------- | ---------------------------------------------------- | -------- | ---- |
| subscriptionId            | subscriptions.subscription_id                        | ✅       | OK   |
| userId                    | subscriptions.user_id, user_plan_applications.user_id | ✅       | OK   |
| planId                    | subscriptions.plan_id, user_plan_applications.plan_id | ✅       | OK   |
| expirationDate            | subscriptions.current_period_end                     | ✅       | OK   |
| platform                  | subscriptions.platform_type, plans.platform_type     | ✅       | OK   |
| subscription status       | subscriptions.subscription_status                    | ✅       | OK   |
| application status        | user_plan_applications.application_status            | ✅       | OK   |
| scheduled_termination対応 | user_plan_applications.application_status            | ✅       | OK   |

---

## 4. RDBインフラストラクチャの確認

### 4.1 RDS構成

- **Construct**: `/packages/cdk/lib/construct/tenant-rds.ts`
- **Stack**: `/packages/cdk/lib/stacks/tenant/tenant-rds-stack.ts`
- **エンジン**: PostgreSQL 15（デフォルト）
- **認証方式**: IAM認証を使用したRDS接続
- **マルチテナント対応**: テナントごとに専用のRDSインスタンスまたはスキーマ
- **セキュリティ**: VPC内のプライベートサブネット、セキュリティグループで制御

### 4.2 RDS接続パターン

- **接続ライブラリ**: pg (node-postgres)
- **接続プーリング**: Pool を使用
- **トランザクション管理**: BEGIN / COMMIT / ROLLBACK をサポート
- **マイグレーション実行**: Custom Resource経由でLambda関数が実行

### 4.3 既存のDynamoDBテーブル

Payment Gateway用に以下のDynamoDBテーブルが存在（RDBとは別）:

- **WebhookEventTable**: Webhookイベントログ（TTL有効）
- **ReceiptCacheTable**: レシート検証キャッシュ（TTL有効）

これらはRDBスキーマとは独立しており、Webhook受信とレシート検証の高速化に使用されています。

---

## 5. 統括責務実装のための必須修正事項まとめ

### 5.1 新規テーブル追加（必須）

- [ ] **flow_execution_logsテーブルの追加**
  - マイグレーションファイル作成: `004_create_flow_execution_logs_table.sql`
  - スキーマ定義: 技術実装詳細.md 6.2節の定義に準拠
  - インデックス:
    - `idx_user_id_created_at (user_id, created_at)`
    - `idx_tenant_id_created_at (tenant_id, created_at)`
    - `idx_status_created_at (status, created_at)`
  - トリガー: `update_flow_execution_logs_updated_at`（updated_at自動更新用）

### 5.2 既存テーブルの修正（不要）

✅ **修正不要**: 既存の3テーブル（plans, subscriptions, user_plan_applications）は統括責務の要件をすべて満たしています。

### 5.3 インデックス追加（不要）

✅ **追加不要**: 既存のインデックスが統括責務の想定クエリパターンを十分にカバーしています。

---

## 6. マイグレーション実装の推奨手順

### ステップ1: マイグレーションファイルの作成

```bash
# ファイルパス
/packages/cdk/database/migrations/004_create_flow_execution_logs_table.sql
```

### ステップ2: マイグレーション内容

```sql
-- Migration: Create flow_execution_logs table
-- Description: フロー実行履歴テーブルを作成します。購入、変更、解約、Webhookイベント処理の各フローの実行状態とステップごとの結果を記録します。

CREATE TABLE IF NOT EXISTS flow_execution_logs (
    -- フロー実行の一意識別子
    flow_execution_id UUID PRIMARY KEY,

    -- フローの種別
    -- 'purchase': 購入フロー
    -- 'change_plan': プラン変更フロー
    -- 'cancel': 解約フロー
    -- 'webhook_event': Webhookイベント処理フロー
    flow_type VARCHAR(50) NOT NULL,

    -- ユーザーID（Cognito sub）
    user_id VARCHAR(255) NOT NULL,

    -- テナントID
    tenant_id VARCHAR(255) NOT NULL,

    -- 実行ステータス
    -- 'processing': 実行中
    -- 'completed': 完了
    -- 'failed': 失敗
    status VARCHAR(50) NOT NULL,

    -- 入力パラメータ（JSON形式）
    input_params JSONB NOT NULL,

    -- エラー情報（失敗時のみ、JSON形式）
    error_info JSONB,

    -- 各ステップの実行結果（JSON配列）
    step_results JSONB,

    -- 作成日時
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 更新日時
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 完了日時
    completed_at TIMESTAMP WITH TIME ZONE,

    -- 制約
    CHECK (flow_type IN ('purchase', 'change_plan', 'cancel', 'webhook_event')),
    CHECK (status IN ('processing', 'completed', 'failed'))
);

-- インデックス

-- user_idと作成日時の複合インデックス（ユーザーごとの履歴取得）
CREATE INDEX IF NOT EXISTS idx_flow_execution_logs_user_id_created_at
    ON flow_execution_logs(user_id, created_at);

-- tenant_idと作成日時の複合インデックス（テナントごとの統計）
CREATE INDEX IF NOT EXISTS idx_flow_execution_logs_tenant_id_created_at
    ON flow_execution_logs(tenant_id, created_at);

-- ステータスと作成日時の複合インデックス（失敗したフローの検索）
CREATE INDEX IF NOT EXISTS idx_flow_execution_logs_status_created_at
    ON flow_execution_logs(status, created_at);

-- 更新日時の自動更新トリガー
CREATE TRIGGER update_flow_execution_logs_updated_at
    BEFORE UPDATE ON flow_execution_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- コメント

COMMENT ON TABLE flow_execution_logs IS '購入、変更、解約、Webhookイベント処理の各フローの実行状態とステップごとの結果を記録するテーブル';
COMMENT ON COLUMN flow_execution_logs.flow_execution_id IS 'フロー実行の一意識別子（UUID）';
COMMENT ON COLUMN flow_execution_logs.flow_type IS 'フローの種別（purchase/change_plan/cancel/webhook_event）';
COMMENT ON COLUMN flow_execution_logs.user_id IS 'ユーザーID（Cognito sub）';
COMMENT ON COLUMN flow_execution_logs.tenant_id IS 'テナントID';
COMMENT ON COLUMN flow_execution_logs.status IS '実行ステータス（processing/completed/failed）';
COMMENT ON COLUMN flow_execution_logs.input_params IS '入力パラメータ（JSON形式）';
COMMENT ON COLUMN flow_execution_logs.error_info IS 'エラー情報（失敗時のみ、JSON形式）';
COMMENT ON COLUMN flow_execution_logs.step_results IS '各ステップの実行結果（JSON配列）';
COMMENT ON COLUMN flow_execution_logs.created_at IS '作成日時';
COMMENT ON COLUMN flow_execution_logs.updated_at IS '更新日時';
COMMENT ON COLUMN flow_execution_logs.completed_at IS '完了日時';
```

### ステップ3: マイグレーション実行

マイグレーションランナーが自動的に検出して実行します:

1. Lambda関数 `applyMigrations` が起動
2. `migrationRunner.runMigrations()` が呼び出される
3. `004_create_flow_execution_logs_table.sql` が適用される
4. `schema_migrations` テーブルに `004` が記録される

### ステップ4: 検証

```sql
-- テーブルが作成されたことを確認
SELECT table_name FROM information_schema.tables
WHERE table_name = 'flow_execution_logs';

-- インデックスが作成されたことを確認
SELECT indexname FROM pg_indexes
WHERE tablename = 'flow_execution_logs';

-- マイグレーションが記録されたことを確認
SELECT version FROM schema_migrations ORDER BY version;
```

---

## 7. 追加の推奨事項（オプション）

### 7.1 データ保持期間の管理

flow_execution_logsテーブルは時間とともに肥大化する可能性があります。以下の対策を推奨:

1. **TTL機能の実装（オプション）**
   - PostgreSQLにはDynamoDBのようなTTL機能がないため、定期バッチで削除
   - 保持期間: 90日（技術実装詳細の推奨値）

2. **パーティショニング（将来的な拡張）**
   - created_atカラムによる月次パーティショニング
   - 古いパーティションを削除することで効率的な管理が可能

### 7.2 監視とアラート

- CloudWatch Logsメトリクスフィルター:
  - `status = 'failed'` の件数を監視
  - エラー率が5%を超えたらアラート

### 7.3 統括責務実装時の注意点

1. **トランザクション管理**
   - flow_execution_logsへの書き込みはフロー処理とは別トランザクションで実行
   - フロー処理が失敗してもログは確実に記録される設計を推奨

2. **ロック競合の回避**
   - flow_execution_logsへの書き込みは INSERT / UPDATE のみ
   - 頻繁なSELECTクエリはインデックスを活用して最適化

3. **JSONB型の活用**
   - input_params, error_info, step_resultsはJSONB型
   - PostgreSQLのJSON関数（jsonb_array_elements, jsonb_path_queryなど）を活用した高度なクエリが可能

---

## 8. まとめ

### 実装状況

- ✅ **プランテーブル（plans）**: 完全実装済み、要件充足
- ✅ **サブスクリプションテーブル（subscriptions）**: 完全実装済み、要件充足
- ✅ **ユーザープラン適用テーブル（user_plan_applications）**: 完全実装済み、scheduled_termination対応
- ❌ **フロー実行ログテーブル（flow_execution_logs）**: 未実装（統括責務に必須）

### 必須アクション

統括責務を実装するためには以下が必須:

1. `004_create_flow_execution_logs_table.sql` マイグレーションファイルの作成
2. マイグレーションの実行
3. 統括責務のLambda関数からのRDB接続実装（既存のパターンに準拠）

### 既存スキーマの品質評価

既存の3テーブル（plans, subscriptions, user_plan_applications）は以下の点で高品質:

- 正規化が適切
- 外部キー制約が設定済み
- インデックスが適切に配置
- 更新日時の自動更新トリガー実装済み
- コメントによるドキュメント化済み
- scheduled_termination状態のサポート
- 適用ソース（subscription/default/trial/campaign/manual）の完全サポート

**結論**: 統括責務実装に向けて、flow_execution_logsテーブルの追加のみが必要です。既存のスキーマは修正不要です。
