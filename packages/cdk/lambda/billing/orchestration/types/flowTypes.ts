/**
 * Flow execution type definitions
 *
 * This file defines types for flow orchestration including:
 * - Flow types and execution status
 * - Flow execution records (DynamoDB schema compatible)
 * - Input/output types for each flow type (purchase, plan change, cancellation)
 */

/**
 * フローの種類
 */
export type FlowType = 'purchase' | 'plan_change' | 'cancellation' | 'webhook_event';

/**
 * フロー実行ステータス
 */
export type FlowExecutionStatus = 'in_progress' | 'completed' | 'failed' | 'rolled_back';

/**
 * 決済プラットフォームの種類
 * @see packages/cdk/lambda/billing/data-access/repositories/types.ts
 */
export type PlatformType = 'stripe' | 'apple' | 'google';

/**
 * フロー実行レコード（DynamoDBスキーマに対応）
 *
 * DynamoDBテーブル: {tenant-id}-flow-execution-history
 * 主キー: flowExecutionId (PK), startedAt (SK)
 * GSI: userId-startedAt-index, tenantId-flowType-index, status-startedAt-index
 */
export interface FlowExecution {
  /** フロー実行ID（UUID v4形式） */
  flowExecutionId: string;

  /** テナントID */
  tenantId: string;

  /** フローの種類 */
  flowType: FlowType;

  /** 対象ユーザID（Webhookイベント処理の場合は後から特定） */
  userId?: string;

  /** 開始者（ユーザID、'system'、'stripe_webhook'、'apple_webhook'、'google_webhook'など） */
  initiatedBy: string;

  /** 実行ステータス */
  status: FlowExecutionStatus;

  /** 実行開始日時（Unixタイムスタンプ、ミリ秒） */
  startedAt: number;

  /** 実行完了日時（Unixタイムスタンプ、ミリ秒） */
  completedAt?: number;

  /** 入力パラメータ（JSON形式） */
  inputParameters: Record<string, unknown>;

  /** 実行結果（JSON形式） */
  outputResult?: Record<string, unknown>;

  /** エラー詳細（JSON形式） */
  errorDetails?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
    /** スタックトレース */
    stackTrace?: string;
  };

  /** 現在実行中のステップ名（進行状況の把握用） */
  currentStep: string;

  /** 総ステップ数 */
  totalSteps?: number;

  /** 完了済みステップ数 */
  completedSteps?: number;

  /** 実行時間（ミリ秒） */
  duration?: number;

  /** TTL（1年後の日時、Unixタイムスタンプ） */
  ttl: number;
}

/**
 * 購入フローの入力パラメータ
 */
export interface PurchaseFlowInput {
  /** テナントID */
  tenantId: string;

  /** ユーザID */
  userId: string;

  /** プランID */
  planId: string;

  /** 決済プラットフォーム */
  paymentPlatform: PlatformType;

  /** レシート情報（プラットフォームごとに異なる） */
  receiptData: unknown;
}

/**
 * 購入フローの出力結果
 */
export interface PurchaseFlowOutput {
  /** 成功フラグ */
  success: boolean;

  /** フロー実行ID */
  flowExecutionId: string;

  /** サブスクリプションID（成功時） */
  subscriptionId?: string;

  /** 権限付与ID（成功時） */
  grantId?: string;

  /** エラー詳細（失敗時） */
  errorDetails?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
  };
}

/**
 * プラン変更フローの入力パラメータ
 */
export interface PlanChangeFlowInput {
  /** テナントID */
  tenantId: string;

  /** ユーザID */
  userId: string;

  /** 現在のプランID */
  currentPlanId: string;

  /** 新しいプランID */
  newPlanId: string;

  /** サブスクリプションID */
  subscriptionId: string;
}

/**
 * プラン変更の種類
 */
export type PlanChangeType = 'upgrade' | 'downgrade';

/**
 * プラン変更フローの出力結果
 */
export interface PlanChangeFlowOutput {
  /** 成功フラグ */
  success: boolean;

  /** フロー実行ID */
  flowExecutionId: string;

  /** 変更タイプ（アップグレード/ダウングレード） */
  changeType: PlanChangeType;

  /** 変更が有効になる日時（ISO 8601形式） */
  effectiveDate: string;

  /** エラー詳細（失敗時） */
  errorDetails?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
  };
}

/**
 * 解約の種類
 */
export type CancellationType = 'immediate' | 'at_period_end';

/**
 * 解約フローの入力パラメータ
 */
export interface CancellationFlowInput {
  /** テナントID */
  tenantId: string;

  /** ユーザID */
  userId: string;

  /** サブスクリプションID */
  subscriptionId: string;

  /** 解約タイプ（即時解約/期限終了時解約） */
  cancellationType: CancellationType;

  /** 解約理由（オプション） */
  reason?: string;
}

/**
 * 解約フローの出力結果
 */
export interface CancellationFlowOutput {
  /** 成功フラグ */
  success: boolean;

  /** フロー実行ID */
  flowExecutionId: string;

  /** 解約タイプ */
  cancellationType: CancellationType;

  /** 解約が有効になる日時（ISO 8601形式） */
  effectiveDate: string;

  /** エラー詳細（失敗時） */
  errorDetails?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
  };
}
