/**
 * Type definitions for Authorization System
 * 権限判定システムの型定義
 */

/**
 * 使用イベントアイテム
 * 機能の使用履歴を記録し、期間ごとの使用回数を集計するために使用
 */
export interface UsageEventItem {
  userId: string; // ユーザID（パーティションキー）
  timestamp: number; // イベント発生時刻（ソートキー、Unixタイムスタンプ、ミリ秒単位）
  featureId: string; // 使用した機能ID
  ttl: number; // TTL属性（Unixタイムスタンプ、秒単位）記録から120日後に自動削除
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
 * カウント加算リクエスト（使用イベント記録リクエスト）
 */
export interface IncrementUsageCountRequest {
  tenantId: string; // テナントID
  userId: string; // ユーザID
  featureId: string; // 機能ID
}

/**
 * カウント加算レスポンス（使用イベント記録レスポンス）
 */
export interface IncrementUsageCountResponse {
  success: true;
  timestamp: number; // 記録されたイベントのタイムスタンプ（Unixタイムスタンプ、ミリ秒単位）
}

/**
 * 利用状況確認リクエスト
 */
export interface GetUsageStatusRequest {
  featureIds: string[];
}

/**
 * 利用状況確認レスポンス
 */
export interface GetUsageStatusResponse {
  results: {
    [featureId: string]: {
      status: 'available' | 'limited' | 'quota_exceeded' | 'no_permission';
      hasLimit: boolean;
      remaining?: number;
      limit?: number;
      periodType?: 'daily' | 'monthly';
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
    };
  };
}
