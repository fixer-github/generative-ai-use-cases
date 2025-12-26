/**
 * Step Executor Service
 *
 * Handles individual step execution with retry logic and error handling.
 * This service is responsible for executing steps, recording execution history,
 * and managing retries for transient failures.
 */

import { StepConfig, StepExecutionResult, StepExecution } from '../types';
import { FlowStepExecutionRepository } from '../repositories/flowStepExecutionRepository';
import { executeWithRetry } from '../utils/retryStrategy';
import {
  logStepStart,
  logStepComplete,
  logStepError,
} from '../utils/flowLogger';

/**
 * StepExecutor
 *
 * ステップ実行の責務を担うサービスクラス。
 * リトライロジック、履歴記録、エラーハンドリングを統合的に管理します。
 */
export class StepExecutor {
  /**
   * StepExecutor のコンストラクタ
   *
   * @param tenantId - テナントID
   * @param flowExecutionId - フロー実行ID
   * @param stepRepository - ステップ実行履歴リポジトリ
   */
  constructor(
    private readonly tenantId: string,
    private readonly flowExecutionId: string,
    private readonly stepRepository: FlowStepExecutionRepository
  ) {}

  /**
   * ステップを実行（リトライ付き）
   *
   * ステップの実行履歴レコードを作成し、executeFunction を呼び出します。
   * エラー時にリトライ可能な場合は、指数バックオフでリトライします。
   * 実行結果に応じてステップ履歴を更新します。
   *
   * @param stepConfig - ステップ設定
   * @param stepSequence - ステップシーケンス番号（0から開始）
   * @param inputData - ステップへの入力データ
   * @returns ステップ実行結果
   *
   * @example
   * ```typescript
   * const executor = new StepExecutor('tenant-123', 'flow-456', repository);
   * const result = await executor.execute(
   *   {
   *     stepName: 'verify_user_auth',
   *     stepType: 'validation',
   *     executeFunction: async (input) => { ... },
   *     retryable: true,
   *     maxRetries: 3
   *   },
   *   0,
   *   { userId: 'user-789' }
   * );
   * ```
   */
  async execute(
    stepConfig: StepConfig,
    stepSequence: number,
    inputData: unknown
  ): Promise<StepExecutionResult> {
    const startedAt = Date.now();

    // ログ出力
    logStepStart(this.flowExecutionId, stepConfig.stepName, stepSequence);

    // ステップ実行履歴レコードを作成（初期状態: in_progress）
    const stepExecution: StepExecution = {
      flowExecutionId: this.flowExecutionId,
      stepSequence,
      stepName: stepConfig.stepName,
      stepType: stepConfig.stepType,
      targetService: stepConfig.targetService,
      targetFunction: stepConfig.targetFunction,
      status: 'in_progress',
      startedAt,
      inputData: this.sanitizeData(inputData),
      retryCount: 0,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
    };

    try {
      await this.stepRepository.create(stepExecution);
    } catch (error) {
      console.error('Failed to create step execution record', {
        flowExecutionId: this.flowExecutionId,
        stepSequence,
        error,
      });
      // 履歴記録の失敗は実行を継続
    }

    // ステップを実行（リトライ付き）
    let retryCount = 0;
    try {
      const outputData = await this.executeWithRetry(
        stepConfig,
        stepSequence,
        inputData,
        retryCount
      );

      // 実行完了時の処理
      const completedAt = Date.now();
      const duration = completedAt - startedAt;

      logStepComplete(this.flowExecutionId, stepConfig.stepName, duration);

      // ステップ履歴を更新
      try {
        await this.stepRepository.update(this.flowExecutionId, stepSequence, {
          status: 'completed',
          completedAt,
          outputData: this.sanitizeData(outputData),
          duration,
        });
      } catch (error) {
        console.error('Failed to update step execution record', {
          flowExecutionId: this.flowExecutionId,
          stepSequence,
          error,
        });
        // 履歴更新の失敗は実行結果に影響しない
      }

      return {
        success: true,
        outputData,
      };
    } catch (error) {
      // 実行失敗時の処理
      const err = error instanceof Error ? error : new Error(String(error));
      const completedAt = Date.now();
      const duration = completedAt - startedAt;

      logStepError(this.flowExecutionId, stepConfig.stepName, err);

      // エラー詳細を構築
      const errorDetails = {
        errorCode: this.extractErrorCode(err),
        errorMessage: err.message,
        stackTrace: err.stack,
      };

      // ステップ履歴を更新
      try {
        await this.stepRepository.update(this.flowExecutionId, stepSequence, {
          status: 'failed',
          completedAt,
          errorDetails,
          retryCount,
          duration,
        });
      } catch (updateError) {
        console.error('Failed to update step execution record', {
          flowExecutionId: this.flowExecutionId,
          stepSequence,
          error: updateError,
        });
        // 履歴更新の失敗は実行結果に影響しない
      }

      return {
        success: false,
        error: {
          errorCode: errorDetails.errorCode,
          errorMessage: errorDetails.errorMessage,
          isRetryable: stepConfig.retryable && retryCount < stepConfig.maxRetries,
        },
      };
    }
  }

  /**
   * ステップをリトライ実行
   *
   * executeFunction を呼び出し、エラー時にリトライ戦略に従ってリトライします。
   *
   * @param stepConfig - ステップ設定
   * @param stepSequence - ステップシーケンス番号
   * @param inputData - ステップへの入力データ
   * @param retryCount - 現在のリトライ回数（参照渡し）
   * @returns ステップからの出力データ
   * @throws {Error} リトライ上限に達した場合、または非リトライ可能エラーの場合
   */
  private async executeWithRetry(
    stepConfig: StepConfig,
    stepSequence: number,
    inputData: unknown,
    retryCount: number
  ): Promise<unknown> {
    if (!stepConfig.retryable || stepConfig.maxRetries === 0) {
      // リトライ不可の場合は直接実行
      return await stepConfig.executeFunction(inputData);
    }

    // リトライ付き実行
    return await executeWithRetry(
      () => stepConfig.executeFunction(inputData),
      {
        maxRetries: stepConfig.maxRetries,
        onRetry: async (attemptNumber, error) => {
          retryCount = attemptNumber + 1;

          console.log('Retrying step execution', {
            flowExecutionId: this.flowExecutionId,
            stepSequence,
            stepName: stepConfig.stepName,
            attemptNumber,
            error: error.message,
          });

          // リトライ回数を更新
          try {
            await this.stepRepository.update(
              this.flowExecutionId,
              stepSequence,
              {
                retryCount,
              }
            );
          } catch (updateError) {
            console.error('Failed to update retry count', {
              flowExecutionId: this.flowExecutionId,
              stepSequence,
              error: updateError,
            });
            // 履歴更新の失敗はリトライ処理に影響しない
          }
        },
      }
    );
  }

  /**
   * データをサニタイズして Record 型に変換
   *
   * unknown 型のデータを DynamoDB に保存可能な形式に変換します。
   * プリミティブ値は { value: ... } の形式でラップします。
   *
   * @param data - サニタイズ対象のデータ
   * @returns Record 型のデータ、またはundefined
   */
  private sanitizeData(data: unknown): Record<string, unknown> | undefined {
    if (data === null || data === undefined) {
      return undefined;
    }

    if (typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }

    // プリミティブ値や配列の場合はラップ
    return { value: data };
  }

  /**
   * エラーからエラーコードを抽出
   *
   * エラーオブジェクトから適切なエラーコードを抽出します。
   * エラーオブジェクトに code プロパティがある場合はそれを使用し、
   * なければエラー名を使用します。
   *
   * @param error - エラーオブジェクト
   * @returns エラーコード
   */
  private extractErrorCode(error: Error): string | undefined {
    // AWS SDK エラーなど、code プロパティを持つエラー
    const errorWithCode = error as Error & { code?: string };
    if (errorWithCode.code) {
      return errorWithCode.code;
    }

    // エラー名をコードとして使用
    if (error.name && error.name !== 'Error') {
      return error.name;
    }

    return undefined;
  }
}
