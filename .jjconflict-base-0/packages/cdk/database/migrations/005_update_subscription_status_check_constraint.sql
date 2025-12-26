-- ========================================
-- Migration: 005_update_subscription_status_check_constraint
-- Description: subscription_statusのCHECK制約を更新して、scheduled_cancellationとrolled_backステータスを追加
-- Date: 2025-11-25
-- ========================================

-- 既存のCHECK制約を削除
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_subscription_status_check;

-- 新しいCHECK制約を追加（scheduled_cancellationとrolled_backを含む）
ALTER TABLE subscriptions
ADD CONSTRAINT subscriptions_subscription_status_check
CHECK (subscription_status IN (
    'active',
    'pending_verification',
    'past_due',
    'canceled',
    'scheduled_cancellation',  -- 解約予定（期間終了時に解約）
    'expired',
    'rolled_back'              -- ロールバック済み
));

-- コメントを更新
COMMENT ON COLUMN subscriptions.subscription_status IS 'サブスクリプションの現在の状態（active/pending_verification/past_due/canceled/scheduled_cancellation/expired/rolled_back）';