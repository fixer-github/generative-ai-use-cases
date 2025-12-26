/**
 * Flow Logger Utility
 *
 * Provides structured logging for flow and step execution tracking.
 * All logs are output in JSON format for CloudWatch Logs integration.
 */

/**
 * ログレベル
 */
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * 構造化ログの基本インターフェース
 */
interface StructuredLog {
  /** タイムスタンプ（ISO 8601形式） */
  timestamp: string;

  /** ログレベル */
  level: LogLevel;

  /** フロー実行ID */
  flowExecutionId: string;

  /** ログメッセージ */
  message: string;

  /** 追加のコンテキスト情報 */
  context?: Record<string, unknown>;
}

/**
 * 構造化ログを出力
 *
 * @param log - ログオブジェクト
 */
function writeLog(log: StructuredLog): void {
  console.log(JSON.stringify(log));
}

/**
 * フロー開始ログを出力
 *
 * フロー実行の開始時に呼び出します。
 * フロー実行ID、フロータイプ、ユーザIDを記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param flowType - フローの種類
 * @param userId - ユーザID（オプション）
 *
 * @example
 * ```typescript
 * logFlowStart('flow-123', 'purchase', 'user-456');
 * ```
 */
export function logFlowStart(
  flowExecutionId: string,
  flowType: string,
  userId?: string
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Flow execution started',
    context: {
      flowType,
      userId,
    },
  });
}

/**
 * フロー完了ログを出力
 *
 * フロー実行の正常完了時に呼び出します。
 * フロー実行ID、実行時間を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param duration - 実行時間（ミリ秒）
 *
 * @example
 * ```typescript
 * logFlowComplete('flow-123', 5000);
 * ```
 */
export function logFlowComplete(flowExecutionId: string, duration: number): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Flow execution completed successfully',
    context: {
      duration,
      durationSeconds: Math.round(duration / 1000),
    },
  });
}

/**
 * フロー失敗ログを出力
 *
 * フロー実行の失敗時に呼び出します。
 * フロー実行ID、エラー情報を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param error - エラーオブジェクト
 *
 * @example
 * ```typescript
 * try {
 *   // フロー実行
 * } catch (error) {
 *   logFlowError('flow-123', error as Error);
 * }
 * ```
 */
export function logFlowError(flowExecutionId: string, error: Error): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    flowExecutionId,
    message: 'Flow execution failed',
    context: {
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
    },
  });
}

/**
 * ステップ開始ログを出力
 *
 * ステップ実行の開始時に呼び出します。
 * フロー実行ID、ステップ名、ステップシーケンスを記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepName - ステップ名
 * @param stepSequence - ステップシーケンス番号
 *
 * @example
 * ```typescript
 * logStepStart('flow-123', 'verify_user_auth', 0);
 * ```
 */
export function logStepStart(
  flowExecutionId: string,
  stepName: string,
  stepSequence: number
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Step execution started',
    context: {
      stepName,
      stepSequence,
    },
  });
}

/**
 * ステップ完了ログを出力
 *
 * ステップ実行の正常完了時に呼び出します。
 * フロー実行ID、ステップ名、実行時間を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepName - ステップ名
 * @param duration - 実行時間（ミリ秒）
 *
 * @example
 * ```typescript
 * logStepComplete('flow-123', 'verify_user_auth', 1500);
 * ```
 */
export function logStepComplete(
  flowExecutionId: string,
  stepName: string,
  duration: number
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Step execution completed successfully',
    context: {
      stepName,
      duration,
      durationSeconds: Math.round(duration / 1000),
    },
  });
}

/**
 * ステップエラーログを出力
 *
 * ステップ実行の失敗時に呼び出します。
 * フロー実行ID、ステップ名、エラー情報を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepName - ステップ名
 * @param error - エラーオブジェクト
 *
 * @example
 * ```typescript
 * try {
 *   // ステップ実行
 * } catch (error) {
 *   logStepError('flow-123', 'verify_user_auth', error as Error);
 * }
 * ```
 */
export function logStepError(
  flowExecutionId: string,
  stepName: string,
  error: Error
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    flowExecutionId,
    message: 'Step execution failed',
    context: {
      stepName,
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
    },
  });
}

/**
 * ロールバック開始ログを出力
 *
 * ロールバック処理の開始時に呼び出します。
 * フロー実行ID、ロールバック対象ステップ数を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepCount - ロールバック対象ステップ数
 *
 * @example
 * ```typescript
 * logRollbackStart('flow-123', 3);
 * ```
 */
export function logRollbackStart(
  flowExecutionId: string,
  stepCount: number
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'WARN',
    flowExecutionId,
    message: 'Flow rollback started',
    context: {
      stepCount,
    },
  });
}

/**
 * ロールバック完了ログを出力
 *
 * ロールバック処理の完了時に呼び出します。
 * フロー実行ID、ロールバック完了ステップ数を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepCount - ロールバック完了ステップ数
 *
 * @example
 * ```typescript
 * logRollbackComplete('flow-123', 3);
 * ```
 */
export function logRollbackComplete(
  flowExecutionId: string,
  stepCount: number
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Flow rollback completed',
    context: {
      stepCount,
    },
  });
}

/**
 * ロールバックステップログを出力
 *
 * 個別ステップのロールバック時に呼び出します。
 * フロー実行ID、ステップ名、ステップシーケンスを記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepName - ステップ名
 * @param stepSequence - ステップシーケンス番号
 *
 * @example
 * ```typescript
 * logRollbackStep('flow-123', 'create_subscription', 2);
 * ```
 */
export function logRollbackStep(
  flowExecutionId: string,
  stepName: string,
  stepSequence: number
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    flowExecutionId,
    message: 'Rolling back step',
    context: {
      stepName,
      stepSequence,
    },
  });
}

/**
 * ロールバックエラーログを出力
 *
 * ロールバック処理中のエラー時に呼び出します。
 * フロー実行ID、ステップ名、エラー情報を記録します。
 *
 * @param flowExecutionId - フロー実行ID
 * @param stepName - ステップ名
 * @param error - エラーオブジェクト
 *
 * @example
 * ```typescript
 * try {
 *   // ロールバック実行
 * } catch (error) {
 *   logRollbackError('flow-123', 'create_subscription', error as Error);
 * }
 * ```
 */
export function logRollbackError(
  flowExecutionId: string,
  stepName: string,
  error: Error
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    flowExecutionId,
    message: 'Step rollback failed',
    context: {
      stepName,
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
    },
  });
}
