-- ============================================================================
-- Plan & Quota Schema for PostgreSQL
-- 認可システム用プラン・クォータスキーマ
-- ============================================================================

-- Create dedicated schema for plan/quota data
CREATE SCHEMA IF NOT EXISTS plans;

-- Set search path
SET search_path TO plans, public;

-- ============================================================================
-- Plans Table
-- プランテーブル
-- ============================================================================

CREATE TABLE IF NOT EXISTS plans (
    plan_id VARCHAR(50) PRIMARY KEY,
    plan_name VARCHAR(100) NOT NULL,
    description TEXT,
    price_usd_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,

    -- Features and permissions as JSONB for flexibility
    features JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Stripe integration (optional)
    stripe_price_id VARCHAR(100),

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_plans_name ON plans(plan_name);

-- ============================================================================
-- Tenant Plans Table
-- テナントプランテーブル
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_plans (
    tenant_id VARCHAR(100) NOT NULL,
    plan_id VARCHAR(50) NOT NULL,

    -- Subscription details
    plan_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'suspended', 'canceled')),

    -- Stripe integration (optional)
    stripe_subscription_id VARCHAR(100),
    stripe_customer_id VARCHAR(100),

    -- Subscription period
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Primary key
    PRIMARY KEY (tenant_id),

    -- Foreign key to plans
    CONSTRAINT fk_tenant_plan
        FOREIGN KEY (plan_id)
        REFERENCES plans(plan_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_plans_plan_id ON tenant_plans(plan_id);
CREATE INDEX IF NOT EXISTS idx_tenant_plans_status ON tenant_plans(status);
CREATE INDEX IF NOT EXISTS idx_tenant_plans_stripe_customer ON tenant_plans(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- ============================================================================
-- Usage Counters Table
-- 使用量カウンターテーブル
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_counters (
    id BIGSERIAL PRIMARY KEY,

    -- Identifiers
    tenant_id VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    date DATE NOT NULL,

    -- Usage data
    count INTEGER NOT NULL DEFAULT 0,
    last_user_id VARCHAR(100),
    plan_id VARCHAR(50),

    -- Timestamps
    last_update TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one counter per tenant/resource/model/date
    CONSTRAINT uq_usage_counter UNIQUE (tenant_id, resource_type, model, date)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON usage_counters(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_model_date ON usage_counters(model, date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_counters(date DESC);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_counters(created_at);

-- ============================================================================
-- Functions and Triggers
-- 関数とトリガー
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for plans table
DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for tenant_plans table
DROP TRIGGER IF EXISTS update_tenant_plans_updated_at ON tenant_plans;
CREATE TRIGGER update_tenant_plans_updated_at
    BEFORE UPDATE ON tenant_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Seed Data: Initial Plans
-- 初期プランデータ
-- ============================================================================

INSERT INTO plans (plan_id, plan_name, description, price_usd_monthly, features)
VALUES
(
    'free',
    'Free Plan',
    'Basic access with limited quotas',
    0,
    '{
        "max_users": 1,
        "usecases": {
            "chat": {"enabled": true},
            "rag": {"enabled": false},
            "agent": {"enabled": false}
        },
        "models": {
            "claude-3-haiku": {"enabled": true, "daily_quota": 100, "monthly_quota": 1000},
            "claude-3-sonnet": {"enabled": false, "daily_quota": 0, "monthly_quota": 0}
        },
        "resources": {
            "max_conversations": 10,
            "max_documents_mb": 10,
            "max_file_upload_mb": 5,
            "conversation_history_days": 7
        },
        "admin_operations": {
            "invite_user": false,
            "manage_users": false,
            "view_usage": true,
            "export_data": false
        }
    }'::jsonb
),
(
    'pro',
    'Pro Plan',
    'Professional plan with enhanced features',
    49,
    '{
        "max_users": 10,
        "usecases": {
            "chat": {"enabled": true},
            "rag": {"enabled": true},
            "agent": {"enabled": true}
        },
        "models": {
            "claude-3-haiku": {"enabled": true, "daily_quota": 1000, "monthly_quota": 20000},
            "claude-3-sonnet": {"enabled": true, "daily_quota": 500, "monthly_quota": 10000},
            "claude-3-opus": {"enabled": false, "daily_quota": 0, "monthly_quota": 0}
        },
        "resources": {
            "max_conversations": 100,
            "max_documents_mb": 100,
            "max_file_upload_mb": 25,
            "conversation_history_days": 30
        },
        "admin_operations": {
            "invite_user": true,
            "manage_users": true,
            "view_usage": true,
            "export_data": true
        }
    }'::jsonb
),
(
    'enterprise',
    'Enterprise Plan',
    'Full-featured enterprise plan with unlimited access',
    299,
    '{
        "max_users": 999999,
        "usecases": {
            "chat": {"enabled": true},
            "rag": {"enabled": true},
            "agent": {"enabled": true}
        },
        "models": {
            "claude-3-haiku": {"enabled": true, "daily_quota": 10000, "monthly_quota": 200000},
            "claude-3-sonnet": {"enabled": true, "daily_quota": 5000, "monthly_quota": 100000},
            "claude-3-opus": {"enabled": true, "daily_quota": 1000, "monthly_quota": 20000}
        },
        "resources": {
            "max_conversations": 999999,
            "max_documents_mb": 10000,
            "max_file_upload_mb": 100,
            "conversation_history_days": 365
        },
        "admin_operations": {
            "invite_user": true,
            "manage_users": true,
            "view_usage": true,
            "export_data": true,
            "view_audit_logs": true
        }
    }'::jsonb
)
ON CONFLICT (plan_id) DO UPDATE SET
    plan_name = EXCLUDED.plan_name,
    description = EXCLUDED.description,
    price_usd_monthly = EXCLUDED.price_usd_monthly,
    features = EXCLUDED.features,
    updated_at = NOW();

-- ============================================================================
-- Cleanup Function for Old Usage Data
-- 古い使用量データのクリーンアップ関数
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_usage_data(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM usage_counters
    WHERE created_at < NOW() - INTERVAL '1 day' * retention_days;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comment on cleanup function
COMMENT ON FUNCTION cleanup_old_usage_data IS 'Deletes usage counter records older than specified retention days (default: 90 days)';

-- ============================================================================
-- Grants and Permissions
-- 権限設定
-- ============================================================================

-- Grant usage on schema to application user (will be set by CDK)
-- GRANT USAGE ON SCHEMA plans TO app_user;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA plans TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA plans TO app_user;

-- ============================================================================
-- Comments
-- コメント
-- ============================================================================

COMMENT ON SCHEMA plans IS 'Schema for plan, subscription, and usage tracking data';
COMMENT ON TABLE plans IS 'Plan definitions (Free, Pro, Enterprise)';
COMMENT ON TABLE tenant_plans IS 'Tenant subscription assignments';
COMMENT ON TABLE usage_counters IS 'Daily usage tracking by tenant and model';

COMMENT ON COLUMN plans.features IS 'JSONB structure: {max_users, usecases{}, models{}, resources{}, admin_operations{}}';
COMMENT ON COLUMN usage_counters.count IS 'Incremental usage count for the day';
