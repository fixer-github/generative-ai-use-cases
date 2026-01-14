-- Migration: Create schema_migrations table
-- Description: マイグレーション管理テーブルを作成します。どのマイグレーションが適用済みかを記録します。

CREATE TABLE IF NOT EXISTS schema_migrations (
    -- マイグレーションファイルのバージョン番号（例: 001, 002, 003）
    version VARCHAR(255) PRIMARY KEY,

    -- そのマイグレーションを適用した日時
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- コメント

COMMENT ON TABLE schema_migrations IS 'どのマイグレーションが適用済みかを記録する管理テーブル';
COMMENT ON COLUMN schema_migrations.version IS 'マイグレーションファイルのバージョン番号';
COMMENT ON COLUMN schema_migrations.applied_at IS 'そのマイグレーションを適用した日時';
