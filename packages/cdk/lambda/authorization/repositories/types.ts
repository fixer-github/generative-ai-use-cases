/**
 * Type definitions for Authorization System
 * 権限判定システムの型定義
 */

/**
 * 利用回数カウントアイテム
 */
export interface UsageCounterItem {
  userId: string; // ユーザID（パーティションキー）
  featureIdPeriod: string; // 機能ID#期間タイプ（ソートキー）例: "feature-model-b#daily"
  featureId: string; // 機能ID（検索用）
  periodType: 'daily' | 'monthly'; // 期間タイプ（検索用）
  currentCount: number; // 現在の利用回数
  limitCount: number; // 上限回数
  nextResetTime: number; // 次回リセット日時（Unixタイムスタンプ、秒単位）
  grantId: string; // 権限付与ID（どの権限付与で追加されたか）
  createdAt: number; // 作成日時（Unixタイムスタンプ、秒単位）
  updatedAt: number; // 更新日時（Unixタイムスタンプ、秒単位）
}

/**
 * 権限付与履歴アイテム
 */
export interface PermissionGrantItem {
  grantId: string; // 権限付与ID（パーティションキー）
  userId: string; // ユーザID
  features: Array<{
    // 付与された機能のリスト
    featureId: string;
    limitType: 'unlimited' | 'daily' | 'monthly';
    limitCount?: number;
  }>;
  status: 'active' | 'revoked'; // 状態
  sourceType: string; // 付与元のタイプ（例: "subscription", "trial", "campaign", "manual"）
  sourceId: string; // 付与元のID（サブスクリプションID、キャンペーンIDなど）
  grantedAt: number; // 付与日時（Unixタイムスタンプ、秒単位）
  revokedAt?: number; // 剥奪日時（Unixタイムスタンプ、秒単位）
}

/**
 * 権限付与リクエスト
 */
export interface GrantPermissionRequest {
  tenantId: string; // テナントID
  userId: string; // ユーザID
  grantId: string; // 権限付与ID（呼び出し元が生成するUUID）
  planId: string; // プランID（Entitlement IDの生成に使用）
  features: Array<{
    featureId: string; // 機能ID（例: "llm:gemini-2.5-flash"）
    limitType: 'unlimited' | 'daily' | 'monthly';
    limitCount?: number; // limitTypeが'unlimited'以外の場合に必須
  }>; // DynamoDBへの回数制限カウンター作成に使用
  sourceType: string; // 付与元のタイプ（例: "subscription", "trial", "campaign", "manual"）
  sourceId: string; // 付与元のID（サブスクリプションID、キャンペーンIDなど）
}

/**
 * 権限付与レスポンス
 */
export interface GrantPermissionResponse {
  success: true;
  grantId: string;
  grantedAt: string; // ISO8601形式
}

/**
 * 権限剥奪リクエスト
 */
export interface RevokePermissionRequest {
  tenantId: string; // テナントID
  grantId: string; // 権限付与ID
}

/**
 * 権限剥奪レスポンス
 */
export interface RevokePermissionResponse {
  success: true;
  grantId: string;
  revokedAt: string; // ISO8601形式
}

/**
 * 権限チェックリクエスト
 */
export interface CheckPermissionRequest {
  tenantId: string; // テナントID
  userId: string; // ユーザID
  featureId: string; // 機能ID
}

/**
 * 権限チェックレスポンス
 */
export interface CheckPermissionResponse {
  allowed: boolean;
  reason?: string; // 拒否理由（"no_permission" | "quota_exceeded"）
  usage?: {
    daily?: {
      current: number;
      limit: number;
      remaining: number;
    };
    monthly?: {
      current: number;
      limit: number;
      remaining: number;
    };
  };
}

/**
 * カウント加算リクエスト
 */
export interface IncrementUsageCountRequest {
  tenantId: string; // テナントID
  userId: string; // ユーザID
  featureId: string; // 機能ID
  periodType: 'daily' | 'monthly'; // 期間タイプ
}

/**
 * カウント加算レスポンス
 */
export interface IncrementUsageCountResponse {
  success: true;
  newCount: number; // 更新後のカウント値
}

/**
 * カウントリセットリクエスト
 */
export interface ResetUsageCountRequest {
  periodType: 'daily' | 'monthly'; // 期間タイプ
}

/**
 * カウントリセットレスポンス
 */
export interface ResetUsageCountResponse {
  success: true;
  processedTenants: number;
  updatedItems: number;
  errors: Array<{
    tenantId: string;
    error: string;
  }>;
}
