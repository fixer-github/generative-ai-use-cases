-- Migration: Add is_default flag to plans table
-- Description: プランテーブルにデフォルトプラン指定用のフラグを追加します

-- is_defaultカラムの追加
ALTER TABLE plans
ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- is_defaultフラグのインデックス（デフォルトプランの高速取得用）
CREATE INDEX IF NOT EXISTS idx_plans_is_default ON plans(is_default) WHERE is_default = TRUE;

-- 一つのプランのみがデフォルトになることを保証する部分インデックス
-- is_default = TRUE となるレコードは最大1つのみ
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_unique_default ON plans(is_default) WHERE is_default = TRUE;

-- コメント
COMMENT ON COLUMN plans.is_default IS 'デフォルトプラン指定フラグ（新規登録ユーザやサブスクリプション解約後に適用されるプラン）';