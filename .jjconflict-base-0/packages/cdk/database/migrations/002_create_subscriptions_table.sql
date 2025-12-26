-- Migration: Create subscriptions table
-- Description: サブスクリプションテーブルを作成します。ユーザの課金プラットフォーム経由の契約情報を保存します。

CREATE TABLE IF NOT EXISTS subscriptions (
    -- サブスクリプションを一意に識別するためのID
    subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- このサブスクリプションを契約しているユーザのID
    user_id VARCHAR(255) NOT NULL,

    -- このサブスクリプションで契約されているプランのID
    plan_id UUID NOT NULL,

    -- プラットフォーム種別
    -- 'stripe': Stripe Billing
    -- 'apple': Apple App Store
    -- 'google': Google Play Store
    platform_type VARCHAR(50) NOT NULL,

    -- 課金プラットフォーム側で管理されているサブスクリプションのID
    -- Stripe: sub_xxxxx, Apple: original_transaction_id, Google: purchaseToken
    platform_subscription_id VARCHAR(255) NOT NULL UNIQUE,

    -- サブスクリプションの現在の状態
    -- 'active': 有効（支払いが成功し、サービスを利用できる）
    -- 'pending_verification': 検証保留中（レシート検証が失敗し、管理者の確認待ち）
    -- 'past_due': 支払い失敗（課金プラットフォームが自動的に再試行中）
    -- 'canceled': キャンセル済み（ユーザまたはシステムによって解約）
    -- 'expired': 期限切れ（有効期限が過ぎた）
    subscription_status VARCHAR(50) NOT NULL,

    -- 現在のサブスクリプション期間の開始日時
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 現在のサブスクリプション期間の終了日時
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 期限終了時にキャンセルするかどうか
    -- true: 現在の期間終了時にキャンセルされる
    -- false: 自動更新が有効で次の期間も継続
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,

    -- 作成日時
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 更新日時
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 外部キー制約
    CONSTRAINT fk_subscriptions_plan
        FOREIGN KEY (plan_id)
        REFERENCES plans(plan_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    -- 制約
    CHECK (platform_type IN ('stripe', 'apple', 'google')),
    CHECK (subscription_status IN ('active', 'pending_verification', 'past_due', 'canceled', 'expired')),
    CHECK (current_period_end > current_period_start)
);

-- インデックス

-- user_idによる検索用（特定ユーザのサブスクリプション情報取得）
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

-- platform_subscription_idによる検索用（Webhookイベント処理でプラットフォーム側IDから特定）
CREATE INDEX IF NOT EXISTS idx_subscriptions_platform_subscription_id ON subscriptions(platform_subscription_id);

-- subscription_statusによる検索用（特定状態のサブスクリプション一覧取得）
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(subscription_status);

-- current_period_endによる検索用（期限切れチェックバッチ処理）
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end);

-- user_idとsubscription_statusの複合インデックス（頻繁に使われるクエリパターン）
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, subscription_status);

-- 更新日時の自動更新トリガー

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- コメント

COMMENT ON TABLE subscriptions IS 'ユーザの課金プラットフォーム経由のサブスクリプション契約情報を保存するテーブル';
COMMENT ON COLUMN subscriptions.subscription_id IS 'サブスクリプションを一意に識別するためのID';
COMMENT ON COLUMN subscriptions.user_id IS 'このサブスクリプションを契約しているユーザのID';
COMMENT ON COLUMN subscriptions.plan_id IS 'このサブスクリプションで契約されているプランのID';
COMMENT ON COLUMN subscriptions.platform_type IS 'プラットフォーム種別（stripe/apple/google）';
COMMENT ON COLUMN subscriptions.platform_subscription_id IS '課金プラットフォーム側で管理されているサブスクリプションのID';
COMMENT ON COLUMN subscriptions.subscription_status IS 'サブスクリプションの現在の状態（active/pending_verification/past_due/canceled/expired）';
COMMENT ON COLUMN subscriptions.current_period_start IS '現在のサブスクリプション期間の開始日時';
COMMENT ON COLUMN subscriptions.current_period_end IS '現在のサブスクリプション期間の終了日時';
COMMENT ON COLUMN subscriptions.cancel_at_period_end IS '期限終了時にキャンセルするかどうか';
COMMENT ON COLUMN subscriptions.created_at IS '作成日時';
COMMENT ON COLUMN subscriptions.updated_at IS '更新日時';
