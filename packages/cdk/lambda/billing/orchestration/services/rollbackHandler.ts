/**
 * Rollback Handler Service
 *
 * Handles rollback of completed steps when a flow execution fails.
 * This service executes rollback functions in reverse order and records
 * rollback execution as special step records.
 */

import { StepConfig, StepExecution } from '../types';
import { FlowStepExecutionRepository } from '../repositories/flowStepExecutionRepository';
import {
  logRollbackStart,
  logRollbackComplete,
  logRollbackStep,
  logRollbackError,
} from '../utils/flowLogger';

/**
 * RollbackHandler
 *
 * ロールバック処理の責務を担うサービスクラス。
 * 完了済みステップを逆順にロールバックし、履歴を記録します。
 */
export class RollbackHandler {
  /**
   * RollbackHandler のコンストラクタ
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
   * 完了済みステップをロールバック
   *
   * 完了済みステップを実行順序と逆順でロールバックします。
   * 各ステップのロールバック処理もステップ履歴として記録します。
   * ロールバック関数が定義されていないステップはスキップします。
   *
   * @param completedSteps - ロールバック対象のステップ情報の配列
   *
   * @example
   * ```typescript
   * const handler = new RollbackHandler('tenant-123', 'flow-456', repository);
   * await handler.rollback([
   *   {
   *     stepSequence: 0,
   *     stepConfig: { ... },
   *     outputData: { ... }
   *   },
   *   {
   *     stepSequence: 1,
   *     stepConfig: { ... },
   *     outputData: { ... }
   *   }
   * ]);
   * ```
   */
  async rollback(
    completedSteps: Array<{
      stepSequence: number;
      stepConfig: StepConfig;
      outputData: unknown;
    }>
  ): Promise<void> {
    if (completedSteps.length === 0) {
      console.log('No completed steps to rollback', {
        flowExecutionId: this.flowExecutionId,
      });
      return;
    }

    logRollbackStart(this.flowExecutionId, completedSteps.length);

    // 逆順でロールバック（最後に実行されたステップから順にロールバック）
    const reversedSteps = [...completedSteps].reverse();
    let rolledBackCount = 0;

    for (const step of reversedSteps) {
      try {
        await this.rollbackStep(
          step.stepSequence,
          step.stepConfig,
          step.outputData
        );
        rolledBackCount++;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        logRollbackError(
          this.flowExecutionId,
          step.stepConfig.stepName,
          err
        );

        console.error('Rollback step failed, continuing with remaining steps', {
          flowExecutionId: this.flowExecutionId,
          stepSequence: step.stepSequence,
          stepName: step.stepConfig.stepName,
          error: err.message,
        });

        // ロールバック失敗は継続（ベストエフォート）
      }
    }

    logRollbackComplete(this.flowExecutionId, rolledBackCount);

    console.log('Rollback completed', {
      flowExecutionId: this.flowExecutionId,
      totalSteps: completedSteps.length,
      rolledBackCount,
      failedCount: completedSteps.length - rolledBackCount,
    });
  }

  /**
   * 個別ステップをロールバック
   *
   * ステップのロールバック関数を実行し、その実行履歴を記録します。
   * ロールバック処理自体もステップとして履歴に記録されます。
   *
   * @param stepSequence - 元のステップシーケンス番号
   * @param stepConfig - ステップ設定
   * @param outputData - ステップの出力データ
   * @throws {Error} ロールバック関数が定義されていない場合、または実行に失敗した場合
   */
  private async rollbackStep(
    stepSequence: number,
    stepConfig: StepConfig,
    outputData: unknown
  ): Promise<void> {
    // ロールバック関数が定義されていない場合はスキップ
    if (!stepConfig.rollbackFunction) {
      console.log('No rollback function defined, skipping', {
        flowExecutionId: this.flowExecutionId,
        stepSequence,
        stepName: stepConfig.stepName,
      });
      return;
    }

    logRollbackStep(this.flowExecutionId, stepConfig.stepName, stepSequence);

    const startedAt = Date.now();

    // ロールバック用のステップ実行履歴レコードを作成
    // ロールバックステップは負のシーケンス番号を使用（-1, -2, ...）
    const rollbackStepSequence = -(stepSequence + 1);
    const rollbackStepExecution: StepExecution = {
      flowExecutionId: this.flowExecutionId,
      stepSequence: rollbackStepSequence,
      stepName: `rollback_${stepConfig.stepName}`,
      stepType: 'rollback',
      targetService: stepConfig.targetService,
      targetFunction: stepConfig.targetFunction,
      status: 'in_progress',
      startedAt,
      inputData: this.sanitizeData(outputData),
      retryCount: 0,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
    };

    try {
      await this.stepRepository.create(rollbackStepExecution);
    } catch (error) {
      console.error('Failed to create rollback step execution record', {
        flowExecutionId: this.flowExecutionId,
        rollbackStepSequence,
        error,
      });
      // 履歴記録の失敗は実行を継続
    }

    try {
      // ロールバック関数を実行
      await stepConfig.rollbackFunction(outputData);

      const completedAt = Date.now();
      const duration = completedAt - startedAt;

      // ロールバックステップ履歴を更新
      try {
        await this.stepRepository.update(
          this.flowExecutionId,
          rollbackStepSequence,
          {
            status: 'completed',
            completedAt,
            duration,
          }
        );
      } catch (error) {
        console.error('Failed to update rollback step execution record', {
          flowExecutionId: this.flowExecutionId,
          rollbackStepSequence,
          error,
        });
        // 履歴更新の失敗はロールバック結果に影響しない
      }

      console.log('Rollback step completed', {
        flowExecutionId: this.flowExecutionId,
        stepSequence,
        stepName: stepConfig.stepName,
        duration,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const completedAt = Date.now();
      const duration = completedAt - startedAt;

      // エラー詳細を構築
      const errorDetails = {
        errorCode: this.extractErrorCode(err),
        errorMessage: err.message,
        stackTrace: err.stack,
      };

      // ロールバックステップ履歴を更新
      try {
        await this.stepRepository.update(
          this.flowExecutionId,
          rollbackStepSequence,
          {
            status: 'failed',
            completedAt,
            errorDetails,
            duration,
          }
        );
      } catch (updateError) {
        console.error('Failed to update rollback step execution record', {
          flowExecutionId: this.flowExecutionId,
          rollbackStepSequence,
          error: updateError,
        });
        // 履歴更新の失敗はロールバック結果に影響しない
      }

      throw new Error(
        `Rollback failed for step ${stepConfig.stepName}: ${err.message}`
      );
    }
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
