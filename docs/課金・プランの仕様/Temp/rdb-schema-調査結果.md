# データモデル（RDB） 調査結果

## 調査概要

**調査日時**: 2025-11-14
**調査対象ディレクトリ**: `packages/cdk/`配下
**データベース種別**: PostgreSQL 15（Amazon RDS）
**マルチテナント方式**: テナントごとに独立したRDSインスタンスを作成

## 1. RDSインフラ構成

### 実装状況: **実装済み**

### 定義場所
- **Constructファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/tenant-rds.ts`
- **Stackファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/tenant/tenant-rds-stack.ts`

### インフラ構成の詳細
- **データベースエンジン**: PostgreSQL 15
- **インスタンスタイプ**: デフォルトt3.micro（設定可能）
- **デプロイメント**: VPC内のプライベートサブネット（PRIVATE_WITH_EGRESS）
- **マルチAZ**: 本番環境では有効、開発環境では無効
- **ストレージ暗号化**: 有効
- **バックアップ保持期間**: デフォルト7日間
- **自動マイグレーション**: Custom Resource経由でデプロイ時に実行

### マイグレーション機構
- **マイグレーションLambda**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/database-migration/applyMigrations.ts`
- **マイグレーションファイル配置**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/`
- **実行タイミング**: CloudFormationカスタムリソースによりスタック作成/更新時に自動実行

---

## 2. プランテーブル

### 実装状況: **実装済み**

### 定義場所
**マイグレーションファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/001_create_plans_table.sql`

### カラム定義

| カラム名 | データ型 | 制約 | 説明 |
|---------|---------|------|------|
| `plan_id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | プランを一意に識別するID |
| `internal_name` | VARCHAR(255) | NOT NULL, UNIQUE | システム管理者用の内部名称 |
| `display_name` | VARCHAR(255) | NOT NULL | ユーザに表示されるプラン名 |
| `description` | TEXT | NULL | プランの詳細説明 |
| `platform_type` | VARCHAR(50) | NOT NULL, CHECK (stripe/apple/google/internal) | プラットフォーム種別 |
| `platform_product_id` | VARCHAR(255) | NULL | 課金プラットフォーム側の商品ID |
| `permissions` | JSONB | NOT NULL | 機能権限と回数制限を定義したJSON |
| `status` | VARCHAR(50) | NOT NULL, DEFAULT 'active', CHECK (active/closed_to_new/deprecated) | プランの状態 |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 作成日時 |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 更新日時（トリガーで自動更新） |

### インデックス
1. `idx_plans_internal_name` ON `internal_name`
2. `idx_plans_platform_status` ON (`platform_type`, `status`)
3. `idx_plans_platform_product_id` ON `platform_product_id` WHERE `platform_product_id IS NOT NULL`（部分インデックス）

### トリガー
- `update_plans_updated_at`: 更新時に`updated_at`を自動更新

### Repositoryクラス
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/repositories/planRepository.ts`

**主要メソッド**:
- `create()`: プランを作成
- `findById()`: プランIDで検索
- `findByInternalName()`: 内部名称で検索
- `findByPlatformProductId()`: プラットフォーム商品IDで検索
- `findAll()`: プラン一覧取得（フィルタ・ソート対応）
- `findActiveByPlatform()`: 特定プラットフォームの有効なプラン一覧取得
- `update()`: プラン情報更新
- `deprecate()`: プランを廃止状態に変更

### 技術実装詳細.mdの期待との整合性
**✅ 完全に一致**: 期待されているカラム、インデックス、制約がすべて実装されている。

---

## 3. サブスクリプションテーブル

### 実装状況: **実装済み**

### 定義場所
**マイグレーションファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/002_create_subscriptions_table.sql`

### カラム定義

| カラム名 | データ型 | 制約 | 説明 |
|---------|---------|------|------|
| `subscription_id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | サブスクリプションID |
| `user_id` | VARCHAR(255) | NOT NULL | ユーザID |
| `plan_id` | UUID | NOT NULL, FOREIGN KEY → plans(plan_id) | プランID（外部キー） |
| `platform_type` | VARCHAR(50) | NOT NULL, CHECK (stripe/apple/google) | プラットフォーム種別 |
| `platform_subscription_id` | VARCHAR(255) | NOT NULL, UNIQUE | プラットフォーム側のサブスクリプションID |
| `subscription_status` | VARCHAR(50) | NOT NULL, CHECK (active/pending_verification/past_due/canceled/expired) | サブスクリプション状態 |
| `current_period_start` | TIMESTAMP WITH TIME ZONE | NOT NULL | 現在の期間開始日時 |
| `current_period_end` | TIMESTAMP WITH TIME ZONE | NOT NULL | 現在の期間終了日時 |
| `cancel_at_period_end` | BOOLEAN | NOT NULL, DEFAULT false | 期限終了時にキャンセルするか |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 作成日時 |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 更新日時（トリガーで自動更新） |

### 外部キー制約
- `fk_subscriptions_plan`: `plan_id` → `plans(plan_id)`
  - ON DELETE RESTRICT（プラン削除時はエラー）
  - ON UPDATE CASCADE（プランID更新時は自動追従）

### CHECK制約
- `current_period_end > current_period_start`: 期間の整合性を保証

### インデックス
1. `idx_subscriptions_user_id` ON `user_id`
2. `idx_subscriptions_platform_subscription_id` ON `platform_subscription_id`
3. `idx_subscriptions_status` ON `subscription_status`
4. `idx_subscriptions_period_end` ON `current_period_end`（期限切れチェックバッチ用）
5. `idx_subscriptions_user_status` ON (`user_id`, `subscription_status`)（複合インデックス）

### トリガー
- `update_subscriptions_updated_at`: 更新時に`updated_at`を自動更新

### Repositoryクラス
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/repositories/subscriptionRepository.ts`

**主要メソッド**:
- `create()`: サブスクリプション作成
- `findById()`: サブスクリプションIDで検索
- `findByPlatformSubscriptionId()`: プラットフォーム側IDで検索
- `findByUserId()`: ユーザIDで検索
- `findActiveByUserId()`: ユーザの有効なサブスクリプション取得
- `findExpiringSoon()`: 期限切れ間近のサブスクリプション取得
- `update()`: サブスクリプション更新
- `cancel()`: サブスクリプションをキャンセル
- `extendPeriod()`: 有効期限延長
- `getStatistics()`: 管理者向け統計情報取得
- `findAllForAdmin()`: 管理者向け一覧取得（ページネーション対応）

### 技術実装詳細.mdの期待との整合性
**✅ 完全に一致**: 期待されているすべてのカラム、外部キー制約、インデックスが実装されている。

---

## 4. ユーザプラン適用テーブル

### 実装状況: **実装済み**

### 定義場所
**マイグレーションファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/003_create_user_plan_applications_table.sql`

### カラム定義

| カラム名 | データ型 | 制約 | 説明 |
|---------|---------|------|------|
| `application_id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | プラン適用ID |
| `user_id` | VARCHAR(255) | NOT NULL | ユーザID |
| `plan_id` | UUID | NOT NULL, FOREIGN KEY → plans(plan_id) | プランID（外部キー） |
| `application_source` | VARCHAR(50) | NOT NULL, CHECK (subscription/default/trial/campaign/manual) | プラン適用ソース |
| `application_source_id` | VARCHAR(255) | NULL | 適用ソースに関連するID（サブスクリプションID等） |
| `application_status` | VARCHAR(50) | NOT NULL, CHECK (active/scheduled_termination/expired) | プラン適用状態 |
| `valid_from` | TIMESTAMP WITH TIME ZONE | NOT NULL | 有効期間開始日時 |
| `valid_until` | TIMESTAMP WITH TIME ZONE | NULL | 有効期間終了日時（無期限の場合はNULL） |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 作成日時 |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT CURRENT_TIMESTAMP | 更新日時（トリガーで自動更新） |

### 外部キー制約
- `fk_user_plan_applications_plan`: `plan_id` → `plans(plan_id)`
  - ON DELETE RESTRICT（プラン削除時はエラー）
  - ON UPDATE CASCADE（プランID更新時は自動追従）

### CHECK制約
- `valid_until IS NULL OR valid_until > valid_from`: 期間の整合性を保証

### インデックス
1. `idx_user_plan_applications_user_status` ON (`user_id`, `application_status`)（複合インデックス、最頻出クエリ用）
2. `idx_user_plan_applications_source_id` ON `application_source_id` WHERE `application_source_id IS NOT NULL`（部分インデックス）
3. `idx_user_plan_applications_valid_until_status` ON (`valid_until`, `application_status`) WHERE `valid_until IS NOT NULL`（部分インデックス、期限切れチェックバッチ用）
4. `idx_user_plan_applications_user_id` ON `user_id`

### トリガー
- `update_user_plan_applications_updated_at`: 更新時に`updated_at`を自動更新

### Repositoryクラス
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/repositories/userPlanApplicationRepository.ts`

**主要メソッド**:
- `create()`: プラン適用作成
- `findById()`: 適用IDで検索
- `findByUserId()`: ユーザIDで検索
- `findActiveByUserId()`: ユーザの有効なプラン適用取得
- `findByApplicationSourceId()`: 適用ソースID（サブスクリプションID等）で検索
- `findExpiringSoon()`: 期限切れ間近のプラン適用取得
- `findScheduledTermination()`: 解約予定のプラン適用取得
- `update()`: プラン適用更新
- `scheduleTermination()`: 解約予定としてマーク
- `expire()`: 期限切れとしてマーク
- `extendValidity()`: 有効期限延長

### 技術実装詳細.mdの期待との整合性
**✅ 完全に一致**: 期待されているすべてのカラム、外部キー制約、インデックスが実装されている。

---

## 5. 外部キー制約

### 実装状況: **実装済み**

### 定義されている制約

#### 5.1 サブスクリプションテーブル
```sql
CONSTRAINT fk_subscriptions_plan
    FOREIGN KEY (plan_id)
    REFERENCES plans(plan_id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
```

#### 5.2 ユーザプラン適用テーブル
```sql
CONSTRAINT fk_user_plan_applications_plan
    FOREIGN KEY (plan_id)
    REFERENCES plans(plan_id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
```

### 外部キー制約の詳細
- **参照整合性保証**: プランIDが存在しない状態でサブスクリプションやプラン適用を作成できない
- **削除防止**: 使用中のプランは削除できない（ON DELETE RESTRICT）
- **更新追従**: プランIDが更新された場合、参照しているレコードも自動更新（ON UPDATE CASCADE）

### 技術実装詳細.mdの期待との整合性
**✅ 完全に一致**: 期待されているすべての外部キー制約が実装されている。

---

## 6. インデックス

### 実装状況: **実装済み**

### 定義されているインデックス一覧

#### 6.1 プランテーブル
1. `idx_plans_internal_name`: 内部名称検索用
2. `idx_plans_platform_status`: プラットフォームとステータスによる検索用
3. `idx_plans_platform_product_id`: Webhookイベント処理でプラットフォーム側IDからプラン特定（部分インデックス）

#### 6.2 サブスクリプションテーブル
1. `idx_subscriptions_user_id`: ユーザIDによる検索
2. `idx_subscriptions_platform_subscription_id`: Webhookイベント処理用
3. `idx_subscriptions_status`: ステータスによる検索
4. `idx_subscriptions_period_end`: 期限切れチェックバッチ処理用
5. `idx_subscriptions_user_status`: ユーザIDとステータスの複合検索（最頻出クエリ用）

#### 6.3 ユーザプラン適用テーブル
1. `idx_user_plan_applications_user_status`: ユーザIDとステータスの複合検索（最頻出クエリ用）
2. `idx_user_plan_applications_source_id`: サブスクリプションIDからプラン適用を特定（部分インデックス）
3. `idx_user_plan_applications_valid_until_status`: 期限切れチェックバッチ処理用（部分インデックス）
4. `idx_user_plan_applications_user_id`: ユーザIDによる全プラン適用履歴取得

### インデックス設計の特徴
- **部分インデックス**: NULL値を除外してインデックスサイズを削減
- **複合インデックス**: 頻繁に組み合わせて検索されるカラムを複合インデックス化
- **クエリ最適化**: 統括責務が必要とする検索パターン（ユーザID、有効期限、Webhook処理）をすべてカバー

### 技術実装詳細.mdの期待との整合性
**✅ 完全に一致**: 統括責務が必要とするすべての検索パターンに対応したインデックスが実装されている。

---

## 7. スキーママイグレーション管理

### 実装状況: **実装済み**

### マイグレーション管理テーブル
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/000_create_schema_migrations_table.sql`

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### マイグレーション実行順序
1. `000_create_schema_migrations_table.sql`: マイグレーション管理テーブル作成
2. `001_create_plans_table.sql`: プランテーブル作成
3. `002_create_subscriptions_table.sql`: サブスクリプションテーブル作成（プランテーブルへの外部キー設定）
4. `003_create_user_plan_applications_table.sql`: ユーザプラン適用テーブル作成（プランテーブルへの外部キー設定）

### マイグレーションの冪等性
- すべてのDDL文で`IF NOT EXISTS`を使用
- 既に適用済みのマイグレーションはスキップされる
- CDKデプロイ時に自動実行されるが、複数回実行しても安全

---

## 8. Repositoryクラスの実装

### 実装状況: **実装済み**

### BaseRepository
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/repositories/baseRepository.ts`

- PostgreSQL接続プール管理
- クエリ実行の共通ロジック
- トランザクション管理
- エラーハンドリング

### 型定義
**ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/repositories/types.ts`

統括責務が必要とする完全な型定義:
- `Plan`: プラン定義（permissions構造含む）
- `Subscription`: サブスクリプション契約
- `UserPlanApplication`: ユーザプラン適用
- `RdsConfig`: RDS接続設定

---

## 9. 統括責務が動作する上で必須の修正事項

**修正事項: なし**

すべての期待されるデータモデルが完全に実装されており、統括責務が必要とする以下の操作がすべて可能:

1. ✅ プラン検証（`PlanRepository.findById()`）
2. ✅ サブスクリプション作成（`SubscriptionRepository.create()`）
3. ✅ サブスクリプション状態更新（`SubscriptionRepository.update()`）
4. ✅ サブスクリプション有効期限延長（`SubscriptionRepository.extendPeriod()`）
5. ✅ プラン適用作成（`UserPlanApplicationRepository.create()`）
6. ✅ プラン適用終了（`UserPlanApplicationRepository.expire()`）
7. ✅ プラン適用状態更新（`UserPlanApplicationRepository.update()`）
8. ✅ 外部キー制約による参照整合性保証
9. ✅ インデックスによる高速検索
10. ✅ トランザクション管理機能

---

## 10. 補足事項

### 10.1 データベース選定理由
PostgreSQLを選定した理由（推測）:
- **JSONB型**: 権限定義（permissions）をJSONBで柔軟に管理
- **外部キー制約**: 参照整合性を厳密に保証
- **トランザクションACID特性**: 課金データの整合性確保
- **部分インデックス**: NULLを除外したインデックスでストレージ効率化
- **タイムゾーン対応**: マルチプラットフォーム対応のため、TIMESTAMP WITH TIME ZONEを使用

### 10.2 マルチテナント戦略
- **テナントごとに独立したRDSインスタンス**: データ完全分離によるセキュリティ確保
- **VPC分離**: テナントごとに専用VPCまたはVPC内サブネット分離
- **自動マイグレーション**: テナント作成時に自動的にスキーマ作成

### 10.3 運用上の考慮事項
実装済みの運用機能:
- **自動バックアップ**: 7日間保持（デフォルト）
- **ストレージ自動拡張**: 20GB〜100GB（デフォルト設定）
- **暗号化**: 保存時暗号化有効
- **監視**: Performance Insights有効（本番環境）、CloudWatch Logs出力
- **高可用性**: Multi-AZ（本番環境）

### 10.4 技術実装詳細.mdとの完全一致
調査の結果、`docs/課金・プランの仕様/購入・変更・解約などの複数ステップの処理を統括する/技術実装詳細.md`で期待されているすべてのデータモデル要件が完全に実装されていることを確認しました。

追加で実装されている機能:
- 管理者向け統計情報取得API
- ページネーション対応の検索機能
- 複数の部分インデックスによるクエリ最適化
- 自動更新トリガー（updated_atカラム）

### 10.5 今後の拡張性
現在の実装は以下の拡張にも対応可能:
- 新しいプラットフォーム追加（`platform_type`にenumを追加するだけ）
- 新しい適用ソース追加（`application_source`にenumを追加）
- 権限定義の柔軟な変更（JSONB型による）
- 追加のステータス種別（CHECK制約を変更）

---

## 調査結論

**統括責務が期待するRDBデータモデルは完全に実装されています。**

- ✅ プランテーブル: 完全実装
- ✅ サブスクリプションテーブル: 完全実装
- ✅ ユーザプラン適用テーブル: 完全実装
- ✅ 外部キー制約: すべて実装
- ✅ インデックス: 最適化されたインデックスがすべて実装
- ✅ Repositoryクラス: 完全な抽象化レイヤー実装
- ✅ マイグレーション機構: 自動実行機能実装

**統括責務の実装を開始するための前提条件はすべて満たされています。**
