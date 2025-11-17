# レビュー結果: データベースマイグレーション

## 担当ファイル
- /Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/000_create_schema_migrations_table.sql
- /Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/001_create_plans_table.sql
- /Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/002_create_subscriptions_table.sql
- /Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/database/migrations/003_create_user_plan_applications_table.sql

## 重大な問題（Critical）

### 1. マイグレーションスクリプトにロールバック機能がない
**ファイル**: 全マイグレーションスクリプト

**問題点**:
- すべてのマイグレーションスクリプトは`CREATE TABLE`文のみで構成されており、ロールバック用の`DROP TABLE`文が存在しません
- マイグレーションの適用に失敗した場合や、ロールバックが必要になった際の対処方法が定義されていません

**影響**:
- マイグレーションの失敗時に手動でのロールバック作業が必要になる
- プロダクション環境でのリスクが増大する

**推奨対応**:
- 各マイグレーションファイルに対応するロールバックスクリプト（例: `001_create_plans_table_rollback.sql`）を作成する
- または、マイグレーションツール（Flyway、Liquibaseなど）の導入を検討する

### 2. subscription_statusの値の不一致
**ファイル**:
- `002_create_subscriptions_table.sql` (L58)
- `packages/cdk/lambda/billing/data-access/repositories/types.ts` (L38-44)

**問題点**:
マイグレーションスクリプトとTypeScript型定義で許可される値が不一致です。

- マイグレーションスクリプト: `'active' | 'pending_verification' | 'past_due' | 'canceled' | 'expired'`
- TypeScript型定義: `'active' | 'pending_verification' | 'past_due' | 'canceled' | 'expired' | 'rejected'`

TypeScript型定義には`'rejected'`が含まれていますが、データベースのCHECK制約では許可されていません。

**影響**:
- `'rejected'`ステータスを設定しようとするとデータベースエラーが発生する
- 実行時エラーが発生する可能性が高い

**推奨対応**:
- データベースのCHECK制約に`'rejected'`を追加するか、TypeScript型定義から`'rejected'`を削除する

### 3. トリガー関数の重複定義リスク
**ファイル**: `001_create_plans_table.sql` (L64-70)

**問題点**:
`update_updated_at_column()`関数は`CREATE OR REPLACE FUNCTION`で定義されていますが、この関数は他のマイグレーションスクリプト（002、003）でも使用されています。001が最初に実行されることが前提となっていますが、関数の存在チェックがありません。

**影響**:
- マイグレーションの順序が変わると、関数が未定義でトリガー作成に失敗する可能性がある
- 独立したマイグレーションスクリプトとしての原則に反する

**推奨対応**:
- 共通関数は別の初期化マイグレーション（例: `000_create_common_functions.sql`）として分離する
- または、各マイグレーションスクリプトで`CREATE OR REPLACE FUNCTION`を繰り返し実行する（現状のまま明示的にドキュメント化する）

## 警告レベルの問題（Warning）

### 4. インデックス作成順序の最適化不足
**ファイル**:
- `001_create_plans_table.sql` (L54)
- `002_create_subscriptions_table.sql` (L68)

**問題点**:
複合インデックスがある場合に、単一カラムのインデックスが重複している可能性があります。

例（plansテーブル）:
- `idx_plans_internal_name` (internal_name) ← UNIQUE制約があるため不要
- `idx_plans_platform_status` (platform_type, status)

`internal_name`にはUNIQUE制約があるため、自動的にインデックスが作成されます。明示的な単一カラムインデックスは冗長です。

**影響**:
- ストレージの無駄
- INSERT/UPDATE時のパフォーマンス低下（わずかですが）

**推奨対応**:
- UNIQUE制約のあるカラムへの明示的なインデックス作成を削除する（L54を削除）

### 5. platform_product_idのユニーク性の保証がない
**ファイル**: `001_create_plans_table.sql` (L28)

**問題点**:
`platform_product_id`カラムはNULL可能ですが、UNIQUE制約がありません。同じ`platform_product_id`を持つ複数のプランが存在する可能性があります。

**影響**:
- 同じ商品IDで複数のプランが登録された場合、Webhookイベント処理時にどのプランを選択すべきか判断できない
- `findByPlatformProductId`メソッドが最初の1件のみを返すため、予期しない動作になる可能性がある

**推奨対応**:
- `platform_product_id`にUNIQUE制約を追加する
- または、`(platform_type, platform_product_id)`の複合UNIQUE制約を追加する（より適切）

```sql
-- 推奨される制約
CONSTRAINT unique_platform_product_id
    UNIQUE (platform_type, platform_product_id)
```

### 6. user_idカラムの外部キー制約がない
**ファイル**:
- `002_create_subscriptions_table.sql` (L9)
- `003_create_user_plan_applications_table.sql` (L9)

**問題点**:
`user_id`カラムはVARCHAR(255)として定義されていますが、外部キー制約がありません。ユーザーテーブル（おそらくCognito User Pool）への参照整合性が保証されていません。

**影響**:
- 存在しないユーザーIDでレコードを作成できてしまう
- データ整合性の問題が発生する可能性がある

**推奨対応**:
- usersテーブルが存在する場合は外部キー制約を追加する
- Cognito User Poolを使用している場合は、アプリケーション層でのバリデーションを確実に行い、コメントでその旨を明記する

### 7. タイムゾーン情報の考慮
**ファイル**: 全マイグレーションスクリプト

**問題点**:
すべてのタイムスタンプカラムは`TIMESTAMP WITH TIME ZONE`を使用しており、これは良い設計です。しかし、PostgreSQLのデフォルトタイムゾーン設定が明示されていません。

**影響**:
- 環境によって異なるタイムゾーンで保存される可能性がある
- 特に`CURRENT_TIMESTAMP`のデフォルト値の解釈が環境依存になる

**推奨対応**:
- データベース接続時に`SET TIMEZONE TO 'UTC'`を実行することをドキュメント化する
- または、マイグレーションスクリプトの冒頭で明示的に設定する

## 軽微な問題・改善提案（Info）

### 8. インデックス命名規則の一貫性
**ファイル**: 全マイグレーションスクリプト

**観察**:
インデックス名は`idx_{table}_{columns}`の命名規則に従っており、一貫性があります。これは良い実践です。

**改善提案**:
- 部分インデックス（WHERE句付き）の場合は、命名規則に`_partial`または条件を示すサフィックスを追加することを検討してください

例:
```sql
-- 現在
idx_plans_platform_product_id
-- 提案
idx_plans_platform_product_id_notnull
```

### 9. コメントの充実度
**ファイル**: 全マイグレーションスクリプト

**観察**:
すべてのテーブルとカラムに対して`COMMENT ON`文で説明が付与されており、非常に良い実践です。

**改善提案**:
- インデックスにもコメントを追加することで、その目的と使用されるクエリパターンを明確にできます

```sql
COMMENT ON INDEX idx_subscriptions_period_end IS '期限切れチェックバッチ処理で使用';
```

### 10. トリガーの動作説明
**ファイル**:
- `001_create_plans_table.sql` (L72-75)
- `002_create_subscriptions_table.sql` (L81-84)
- `003_create_user_plan_applications_table.sql` (L78-81)

**観察**:
`updated_at`自動更新トリガーが適切に設定されています。

**改善提案**:
トリガーにもコメントを追加して、動作を明確にすることを推奨します:

```sql
COMMENT ON TRIGGER update_plans_updated_at ON plans IS
    'レコード更新時にupdated_atを自動的に現在時刻に更新する';
```

### 11. JSONB検証の不足
**ファイル**: `001_create_plans_table.sql` (L32)

**観察**:
`permissions`カラムはJSONB型ですが、スキーマ検証がありません。

**改善提案**:
PostgreSQL 12以降では、JSON Schema検証をCHECK制約として追加できます。ただし、複雑になるため、アプリケーション層での検証が現実的です。この判断を明示的にドキュメント化することを推奨します。

```sql
-- 例: 必須キーの存在チェック（シンプルな検証）
CHECK (permissions ? 'features' AND permissions ? 'limits')
```

### 12. マイグレーション順序の依存関係の明示
**ファイル**: 全マイグレーションスクリプト

**観察**:
ファイル名のプレフィックス（000, 001, 002, 003）で順序が管理されています。

**改善提案**:
各マイグレーションスクリプトの冒頭に依存関係を明示的にコメントで記載することを推奨します:

```sql
-- Migration: Create subscriptions table
-- Dependencies: 001_create_plans_table.sql (plans table must exist)
-- Description: サブスクリプションテーブルを作成します。
```

### 13. IF NOT EXISTSの使用
**ファイル**: 全マイグレーションスクリプト

**観察**:
すべての`CREATE TABLE`文で`IF NOT EXISTS`が使用されています。

**評価**:
冪等性が保証されており、良い実践です。ただし、マイグレーション管理システムを使用する場合は、二重実行を防ぐ仕組みがあるため、`IF NOT EXISTS`は不要になることがあります。現状の設計（schema_migrationsテーブルでの管理）では適切です。

### 14. データベースロールとパーミッション
**ファイル**: 全マイグレーションスクリプト

**観察**:
テーブル、インデックス、関数の作成者（OWNER）やGRANT文が含まれていません。

**影響**:
- マイグレーション実行ユーザーがすべてのオブジェクトのオーナーになる
- アプリケーションユーザーが適切な権限を持っているかが不明確

**推奨対応**:
別途、権限設定用のスクリプトを用意するか、各マイグレーションスクリプトにGRANT文を追加することを検討してください:

```sql
-- アプリケーションユーザーへの権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

### 15. テーブル定義とリポジトリコードの整合性
**ファイル**: 全マイグレーションスクリプトとリポジトリファイル

**検証結果**:
すべてのテーブル定義とTypeScriptのリポジトリコード、型定義を照合した結果、以下の点を確認しました:

- **plansテーブル**: 完全に一致（subscription_statusの問題を除く）
- **subscriptionsテーブル**: ほぼ一致（subscription_statusの値の不一致あり）
- **user_plan_applicationsテーブル**: 完全に一致

カラム名、データ型、制約が適切にマッピングされています。

### 16. パフォーマンス考慮事項
**ファイル**:
- `002_create_subscriptions_table.sql`
- `003_create_user_plan_applications_table.sql`

**観察**:
頻繁にクエリされるカラムに適切なインデックスが設定されています:
- user_id
- subscription_status
- application_status
- current_period_end
- valid_until

**評価**:
インデックス設計は適切です。ただし、以下の点を今後のパフォーマンステストで確認することを推奨します:

1. 複合インデックスのカラム順序の最適化
2. カバリングインデックスの導入（頻繁なクエリに対して）
3. パーティショニングの検討（データ量が大きくなった場合）

## 総合評価

**要修正**

### 理由:
1. **Critical問題**: subscription_statusの値の不一致は実行時エラーを引き起こす可能性があり、必ず修正が必要です
2. **ロールバック機能の欠如**: プロダクション環境での運用を考慮すると、ロールバック戦略が必須です
3. **platform_product_idのユニーク性**: データ整合性の問題を引き起こす可能性があります

### 肯定的な評価:
- マイグレーションスクリプトの構造は明確で理解しやすい
- コメントが充実しており、保守性が高い
- インデックス設計は概ね適切
- 外部キー制約が適切に設定されている（plansテーブルへの参照）
- トリガーを使用した自動更新機能の実装が適切
- テーブル定義とアプリケーションコードの整合性が取れている

### 必須修正事項:
1. **subscription_statusのCHECK制約に'rejected'を追加**する（または型定義から削除する）
2. **platform_product_idにUNIQUE制約を追加**する
3. **ロールバックスクリプトまたはロールバック戦略を文書化**する

### 推奨修正事項:
1. トリガー関数を共通マイグレーションスクリプトに分離する
2. 冗長なインデックス（idx_plans_internal_name）を削除する
3. user_idの参照整合性の扱いを明確にする
4. データベースロールとパーミッション設定を追加する

上記の必須修正事項を対応すれば、プロダクション環境での使用に耐えうる品質になります。
