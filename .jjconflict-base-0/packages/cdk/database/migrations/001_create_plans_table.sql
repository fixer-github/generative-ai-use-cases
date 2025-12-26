-- Migration: Create plans table
-- Description: プランテーブルを作成します。システムで提供される全てのプラン定義を保存します。

CREATE TABLE IF NOT EXISTS plans (
    -- プランを一意に識別するためのID
    plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- システム管理者がプランを判別するための名前
    -- 例: 'standard_2025_jan_stripe' や 'pro_2025_feb_ios'
    internal_name VARCHAR(255) NOT NULL UNIQUE,

    -- ユーザに表示されるプランの名前
    -- 例: 'Standardプラン' や 'Proプラン'
    display_name VARCHAR(255) NOT NULL,

    -- プランの詳しい説明文
    description TEXT,

    -- プラットフォーム種別
    -- 'stripe': Stripe Billing経由
    -- 'apple': Apple App Store経由
    -- 'google': Google Play Store経由
    -- 'internal': 課金プラットフォームを経由しないプラン
    platform_type VARCHAR(50) NOT NULL,

    -- 課金プラットフォーム側の商品ID
    -- Stripe: price_xxxxx, Apple: com.example.standard_monthly, Google: standard_monthly
    platform_product_id VARCHAR(255),

    -- プランで利用できる機能と利用回数の制限を定義したJSON
    -- 構造: { "features": [...], "limits": {...} }
    permissions JSONB NOT NULL,

    -- プランの状態
    -- 'active': 新規ユーザが加入できる
    -- 'closed_to_new': 既存ユーザは継続できるが新規加入不可（グランドファザリング）
    -- 'deprecated': 廃止済み（加入者が0人になった後に設定）
    status VARCHAR(50) NOT NULL DEFAULT 'active',

    -- 作成日時
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 更新日時
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 制約
    CHECK (platform_type IN ('stripe', 'apple', 'google', 'internal')),
    CHECK (status IN ('active', 'closed_to_new', 'deprecated'))
);

-- インデックス

-- internal_nameによる検索用
CREATE INDEX IF NOT EXISTS idx_plans_internal_name ON plans(internal_name);

-- platform_typeとstatusによる検索用（特定プラットフォームで提供中のプラン一覧取得）
CREATE INDEX IF NOT EXISTS idx_plans_platform_status ON plans(platform_type, status);

-- platform_product_idによる検索用（Webhookイベント処理でプラットフォーム側IDからプラン特定）
CREATE INDEX IF NOT EXISTS idx_plans_platform_product_id ON plans(platform_product_id) WHERE platform_product_id IS NOT NULL;

-- 更新日時の自動更新トリガー

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- コメント

COMMENT ON TABLE plans IS 'システムで提供される全てのプラン定義を保存するテーブル';
COMMENT ON COLUMN plans.plan_id IS 'プランを一意に識別するためのID';
COMMENT ON COLUMN plans.internal_name IS 'システム管理者がプランを判別するための名前';
COMMENT ON COLUMN plans.display_name IS 'ユーザに表示されるプランの名前';
COMMENT ON COLUMN plans.description IS 'プランの詳しい説明文';
COMMENT ON COLUMN plans.platform_type IS 'プラットフォーム種別（stripe/apple/google/internal）';
COMMENT ON COLUMN plans.platform_product_id IS '課金プラットフォーム側の商品ID';
COMMENT ON COLUMN plans.permissions IS 'プランで利用できる機能と利用回数の制限を定義したJSON';
COMMENT ON COLUMN plans.status IS 'プランの状態（active/closed_to_new/deprecated）';
COMMENT ON COLUMN plans.created_at IS '作成日時';
COMMENT ON COLUMN plans.updated_at IS '更新日時';
