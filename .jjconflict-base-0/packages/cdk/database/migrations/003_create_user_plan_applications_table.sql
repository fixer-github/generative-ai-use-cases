-- Migration: Create user_plan_applications table
-- Description: ユーザプラン適用テーブルを作成します。各ユーザに現在どのプランが適用されているかを記録します。

CREATE TABLE IF NOT EXISTS user_plan_applications (
    -- プラン適用を一意に識別するためのID
    application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- プランが適用されているユーザのID
    user_id VARCHAR(255) NOT NULL,

    -- ユーザに適用されているプランのID
    plan_id UUID NOT NULL,

    -- プラン適用ソース
    -- 'subscription': サブスクリプション経由
    -- 'default': デフォルトプラン
    -- 'trial': トライアル
    -- 'campaign': キャンペーン
    -- 'manual': 管理者による手動付与
    application_source VARCHAR(50) NOT NULL,

    -- 適用ソースに関連するID
    -- subscription: サブスクリプションID
    -- campaign: キャンペーンID
    -- その他: NULLまたは任意の識別情報
    application_source_id VARCHAR(255),

    -- プラン適用の現在の状態
    -- 'active': 有効（ユーザはこのプランの権限を使える）
    -- 'scheduled_termination': 解約予定（期限まで有効だが期限後は自動終了）
    -- 'expired': 期限切れ（既に無効）
    application_status VARCHAR(50) NOT NULL,

    -- 有効期間開始日時
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 有効期間終了日時
    -- サブスクリプション: サブスクリプションの有効期限と同期
    -- トライアル・キャンペーン: それぞれの期限
    -- デフォルトプラン・手動付与で無期限: NULL
    valid_until TIMESTAMP WITH TIME ZONE,

    -- 作成日時
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 更新日時
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 外部キー制約
    CONSTRAINT fk_user_plan_applications_plan
        FOREIGN KEY (plan_id)
        REFERENCES plans(plan_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    -- 制約
    CHECK (application_source IN ('subscription', 'default', 'trial', 'campaign', 'manual')),
    CHECK (application_status IN ('active', 'scheduled_termination', 'expired')),
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- インデックス

-- user_idとapplication_statusによる検索用（最も頻繁に使われるクエリ：特定ユーザの有効なプラン適用取得）
CREATE INDEX IF NOT EXISTS idx_user_plan_applications_user_status ON user_plan_applications(user_id, application_status);

-- application_source_idによる検索用（サブスクリプションIDからプラン適用を特定）
CREATE INDEX IF NOT EXISTS idx_user_plan_applications_source_id ON user_plan_applications(application_source_id) WHERE application_source_id IS NOT NULL;

-- valid_untilとapplication_statusによる検索用（期限切れチェックバッチ処理）
CREATE INDEX IF NOT EXISTS idx_user_plan_applications_valid_until_status ON user_plan_applications(valid_until, application_status) WHERE valid_until IS NOT NULL;

-- user_idによる検索用（ユーザの全プラン適用履歴取得）
CREATE INDEX IF NOT EXISTS idx_user_plan_applications_user_id ON user_plan_applications(user_id);

-- 更新日時の自動更新トリガー

CREATE TRIGGER update_user_plan_applications_updated_at
    BEFORE UPDATE ON user_plan_applications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- コメント

COMMENT ON TABLE user_plan_applications IS '各ユーザに現在どのプランが適用されているかを記録するテーブル';
COMMENT ON COLUMN user_plan_applications.application_id IS 'プラン適用を一意に識別するためのID';
COMMENT ON COLUMN user_plan_applications.user_id IS 'プランが適用されているユーザのID';
COMMENT ON COLUMN user_plan_applications.plan_id IS 'ユーザに適用されているプランのID';
COMMENT ON COLUMN user_plan_applications.application_source IS 'プラン適用ソース（subscription/default/trial/campaign/manual）';
COMMENT ON COLUMN user_plan_applications.application_source_id IS '適用ソースに関連するID';
COMMENT ON COLUMN user_plan_applications.application_status IS 'プラン適用の現在の状態（active/scheduled_termination/expired）';
COMMENT ON COLUMN user_plan_applications.valid_from IS '有効期間開始日時';
COMMENT ON COLUMN user_plan_applications.valid_until IS '有効期間終了日時（無期限の場合はNULL）';
COMMENT ON COLUMN user_plan_applications.created_at IS '作成日時';
COMMENT ON COLUMN user_plan_applications.updated_at IS '更新日時';
