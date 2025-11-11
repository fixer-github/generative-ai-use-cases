/**
 * Type definitions for Plan, Subscription, and User Plan Application entities
 */

/**
 * プラン定義
 */
export interface Plan {
  plan_id: string;
  internal_name: string;
  display_name: string;
  description?: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id?: string;
  permissions: {
    features: string[];
    limits: Record<
      string,
      | { type: 'unlimited' }
      | { type: 'daily'; count: number }
      | { type: 'monthly'; count: number }
    >;
  };
  status: 'active' | 'closed_to_new' | 'deprecated';
  created_at: Date;
  updated_at: Date;
}

/**
 * サブスクリプション契約
 */
export interface Subscription {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  platform_type: 'stripe' | 'apple' | 'google';
  platform_subscription_id: string;
  subscription_status:
    | 'active'
    | 'pending_verification'
    | 'past_due'
    | 'canceled'
    | 'expired'
    | 'rejected';
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * ユーザプラン適用
 */
export interface UserPlanApplication {
  application_id: string;
  user_id: string;
  plan_id: string;
  application_source: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
  application_source_id?: string;
  application_status: 'active' | 'scheduled_termination' | 'expired';
  valid_from: Date;
  valid_until?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * RDS接続設定
 */
export interface RdsConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}
