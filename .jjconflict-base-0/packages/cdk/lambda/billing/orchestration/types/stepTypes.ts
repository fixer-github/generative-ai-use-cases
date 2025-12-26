/**
 * Step execution type definitions
 *
 * This file defines types for step orchestration including:
 * - Step types and execution status
 * - Step execution records (DynamoDB schema compatible)
 * - Step configuration and execution results
 */

/**
 * ステップの種類
 */
export type StepType = 'validation' | 'api_call' | 'data_write' | 'rollback';

/**
 * ステップ実行ステータス
 */
export type StepStatus = 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * ステップ実行レコード（DynamoDBスキーマに対応）
 *
 * DynamoDBテーブル: {tenant-id}-flow-step-execution-history
 * 主キー: flowExecutionId (PK), stepSequence (SK)
 */
export interface StepExecution {
  /** フロー実行ID（親レコードとの紐付け） */
  flowExecutionId: string;

  /** ステップの実行順序（0から開始） */
  stepSequence: number;

  /** ステップの名前（verify_user_auth, validate_plan, verify_receipt, create_subscription, apply_plan, grant_permissionなど） */
  stepName: string;

  /** ステップの種類 */
  stepType: StepType;

  /** 依頼先の責務名（PlanManagement, SubscriptionManagement, PaymentGatewayなど） */
  targetService?: string;

  /** 依頼先のLambda関数名 */
  targetFunction?: string;

  /** ステップの実行ステータス */
  status: StepStatus;

  /** ステップ開始日時（Unixタイムスタンプ、ミリ秒） */
  startedAt: number;

  /** ステップ完了日時（Unixタイムスタンプ、ミリ秒） */
  completedAt?: number;

  /** ステップへの入力データ（JSON形式） */
  inputData?: Record<string, unknown>;

  /** ステップからの出力データ（JSON形式） */
  outputData?: Record<string, unknown>;

  /** エラー詳細（JSON形式） */
  errorDetails?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
    /** スタックトレース */
    stackTrace?: string;
  };

  /** リトライ回数（初回実行は0） */
  retryCount: number;

  /** ステップ実行時間（ミリ秒） */
  duration?: number;

  /** TTL（1年後の日時、Unixタイムスタンプ） */
  ttl: number;
}

/**
 * ステップ設定
 *
 * 各ステップの実行設定を定義します。
 * フロー内で各ステップがどのように実行されるかを指定します。
 */
export interface StepConfig {
  /** ステップの名前 */
  stepName: string;

  /** ステップの種類 */
  stepType: StepType;

  /** 依頼先の責務名（オプション） */
  targetService?: string;

  /** 依頼先のLambda関数名（オプション） */
  targetFunction?: string;

  /** ステップ実行関数 */
  executeFunction: (inputData: unknown) => Promise<unknown>;

  /** ロールバック関数（オプション） */
  rollbackFunction?: (outputData: unknown) => Promise<void>;

  /** リトライ可能フラグ */
  retryable: boolean;

  /** 最大リトライ回数 */
  maxRetries: number;
}

/**
 * ステップ実行結果
 *
 * ステップ実行の成功/失敗と結果データを保持します。
 */
export interface StepExecutionResult {
  /** 成功フラグ */
  success: boolean;

  /** ステップからの出力データ */
  outputData?: unknown;

  /** エラー情報（失敗時） */
  error?: {
    /** エラーコード */
    errorCode?: string;
    /** エラーメッセージ */
    errorMessage: string;
    /** リトライ可能フラグ */
    isRetryable: boolean;
  };
}
