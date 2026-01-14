/**
 * Flow Orchestrator Service
 *
 * Central orchestration service that manages the entire flow execution lifecycle.
 * This service coordinates flow execution, step execution, error handling, and rollback.
 */

import { randomUUID } from 'crypto';
import { FlowType, FlowExecution, StepConfig } from '../types';
import {
  FlowExecutionRepository,
  FlowStepExecutionRepository,
} from '../repositories';
import { StepExecutor } from './stepExecutor';
import { RollbackHandler } from './rollbackHandler';
import { logFlowStart, logFlowComplete, logFlowError } from '../utils/flowLogger';

/**
 * FlowOrchestrator
 *
 * フロー実行全体を統括するサービスクラス。
 * フロー実行の開始、ステップ実行、完了、失敗、ロールバックを管理します。
 */
export class FlowOrchestrator {
  private readonly flowRepository: FlowExecutionRepository;
  private readonly stepRepository: FlowStepExecutionRepository;

  /**
   * FlowOrchestrator のコンストラクタ
   *
   * @param tenantId - テナントID
   */
  constructor(private readonly tenantId: string) {
    this.flowRepository = new FlowExecutionRepository(tenantId);
    this.stepRepository = new FlowStepExecutionRepository(tenantId);
  }

  /**
   * フロー実行を開始
   *
   * 新しいフロー実行を開始し、実行履歴レコードを作成します。
   * フロー実行IDを生成して返します。
   *
   * @param flowType - フローの種類
   * @param userId - ユーザID（オプション、Webhookイベント処理の場合は後から特定）
   * @param initiatedBy - 開始者（ユーザID、'system'、'stripe_webhook'など）
   * @param inputParameters - 入力パラメータ
   * @param totalSteps - 総ステップ数
   * @returns フロー実行ID
   *
   * @example
   * ```typescript
   * const orchestrator = new FlowOrchestrator('tenant-123');
   * const flowExecutionId = await orchestrator.startFlow(
   *   'purchase',
   *   'user-456',
   *   'user-456',
   *   { planId: 'plan-789', ... },
   *   5
   * );
   * ```
   */
  async startFlow(
    flowType: FlowType,
    userId: string | undefined,
    initiatedBy: string,
    inputParameters: Record<string, unknown>,
    totalSteps: number
  ): Promise<string> {
    const flowExecutionId = randomUUID();
    const startedAt = Date.now();

    logFlowStart(flowExecutionId, flowType, userId);

    const flowExecution: FlowExecution = {
      flowExecutionId,
      tenantId: this.tenantId,
      flowType,
      userId,
      initiatedBy,
      status: 'in_progress',
      startedAt,
      inputParameters,
      currentStep: 'initializing',
      totalSteps,
      completedSteps: 0,
      ttl: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
    };

    try {
      await this.flowRepository.create(flowExecution);
    } catch (error) {
      console.error('Failed to create flow execution record', {
        flowExecutionId,
        error,
      });
      throw new Error('Failed to start flow execution');
    }

    console.log('Flow execution started', {
      flowExecutionId,
      flowType,
      userId,
      initiatedBy,
      totalSteps,
    });

    return flowExecutionId;
  }

  /**
   * ステップを実行
   *
   * StepExecutor を使用してステップを実行し、フロー実行の進行状況を更新します。
   *
   * @param flowExecutionId - フロー実行ID
   * @param stepSequence - ステップシーケンス番号（0から開始）
   * @param stepConfig - ステップ設定
   * @param inputData - ステップへの入力データ
   * @returns ステップ実行結果（成功フラグと出力データ）
   *
   * @example
   * ```typescript
   * const result = await orchestrator.executeStep(
   *   'flow-123',
   *   0,
   *   {
   *     stepName: 'verify_user_auth',
   *     stepType: 'validation',
   *     executeFunction: async (input) => { ... },
   *     retryable: true,
   *     maxRetries: 3
   *   },
   *   { userId: 'user-456' }
   * );
   * ```
   */
  async executeStep(
    flowExecutionId: string,
    stepSequence: number,
    stepConfig: StepConfig,
    inputData: unknown
  ): Promise<{ success: boolean; outputData?: unknown }> {
    // フロー実行の現在ステップを更新
    try {
      await this.flowRepository.update(flowExecutionId, {
        currentStep: stepConfig.stepName,
      });
    } catch (error) {
      console.error('Failed to update flow current step', {
        flowExecutionId,
        stepName: stepConfig.stepName,
        error,
      });
      // 履歴更新の失敗は実行を継続
    }

    // StepExecutor を使用してステップを実行
    const stepExecutor = new StepExecutor(
      this.tenantId,
      flowExecutionId,
      this.stepRepository
    );

    const result = await stepExecutor.execute(stepConfig, stepSequence, inputData);

    // 成功時は完了ステップ数を更新
    if (result.success) {
      try {
        await this.flowRepository.update(flowExecutionId, {
          completedSteps: stepSequence + 1,
        });
      } catch (error) {
        console.error('Failed to update completed steps count', {
          flowExecutionId,
          stepSequence,
          error,
        });
        // 履歴更新の失敗は実行を継続
      }
    }

    return {
      success: result.success,
      outputData: result.outputData,
    };
  }

  /**
   * フロー実行を完了
   *
   * フロー実行を正常完了として記録します。
   * ステータスを 'completed' に更新し、完了時刻と実行結果を記録します。
   *
   * @param flowExecutionId - フロー実行ID
   * @param outputResult - 実行結果
   *
   * @example
   * ```typescript
   * await orchestrator.completeFlow('flow-123', {
   *   subscriptionId: 'sub-789',
   *   grantId: 'grant-012'
   * });
   * ```
   */
  async completeFlow(
    flowExecutionId: string,
    outputResult: Record<string, unknown>
  ): Promise<void> {
    const completedAt = Date.now();

    // フロー開始時刻を取得して実行時間を計算
    let duration: number | undefined;
    try {
      const flowExecution = await this.flowRepository.getById(flowExecutionId);
      if (flowExecution) {
        duration = completedAt - flowExecution.startedAt;
      }
    } catch (error) {
      console.error('Failed to get flow execution for duration calculation', {
        flowExecutionId,
        error,
      });
    }

    if (duration !== undefined) {
      logFlowComplete(flowExecutionId, duration);
    }

    try {
      await this.flowRepository.update(flowExecutionId, {
        status: 'completed',
        completedAt,
        outputResult,
        duration,
      });

      console.log('Flow execution completed successfully', {
        flowExecutionId,
        duration,
      });
    } catch (error) {
      console.error('Failed to update flow execution to completed', {
        flowExecutionId,
        error,
      });
      throw error;
    }
  }

  /**
   * フロー実行を失敗として記録
   *
   * フロー実行を失敗として記録します。
   * ステータスを 'failed' に更新し、エラー詳細を記録します。
   *
   * @param flowExecutionId - フロー実行ID
   * @param errorDetails - エラー詳細
   *
   * @example
   * ```typescript
   * await orchestrator.failFlow('flow-123', {
   *   errorCode: 'VALIDATION_ERROR',
   *   errorMessage: 'Invalid plan ID',
   *   stackTrace: '...'
   * });
   * ```
   */
  async failFlow(
    flowExecutionId: string,
    errorDetails: {
      errorCode?: string;
      errorMessage: string;
      stackTrace?: string;
    }
  ): Promise<void> {
    const completedAt = Date.now();

    // フロー開始時刻を取得して実行時間を計算
    let duration: number | undefined;
    try {
      const flowExecution = await this.flowRepository.getById(flowExecutionId);
      if (flowExecution) {
        duration = completedAt - flowExecution.startedAt;
      }
    } catch (error) {
      console.error('Failed to get flow execution for duration calculation', {
        flowExecutionId,
        error,
      });
    }

    const error = new Error(errorDetails.errorMessage);
    if (errorDetails.stackTrace) {
      error.stack = errorDetails.stackTrace;
    }
    logFlowError(flowExecutionId, error);

    try {
      await this.flowRepository.update(flowExecutionId, {
        status: 'failed',
        completedAt,
        errorDetails,
        duration,
      });

      console.log('Flow execution marked as failed', {
        flowExecutionId,
        errorCode: errorDetails.errorCode,
        errorMessage: errorDetails.errorMessage,
        duration,
      });
    } catch (updateError) {
      console.error('Failed to update flow execution to failed', {
        flowExecutionId,
        error: updateError,
      });
      throw updateError;
    }
  }

  /**
   * フロー実行をロールバック
   *
   * 完了済みステップをロールバックし、フロー実行ステータスを 'rolled_back' に更新します。
   * RollbackHandler を使用してステップを逆順にロールバックします。
   *
   * @param flowExecutionId - フロー実行ID
   * @param completedSteps - ロールバック対象のステップ情報の配列
   *
   * @example
   * ```typescript
   * await orchestrator.rollbackFlow('flow-123', [
   *   {
   *     stepSequence: 0,
   *     stepConfig: { ... },
   *     outputData: { ... }
   *   }
   * ]);
   * ```
   */
  async rollbackFlow(
    flowExecutionId: string,
    completedSteps: Array<{
      stepSequence: number;
      stepConfig: StepConfig;
      outputData: unknown;
    }>
  ): Promise<void> {
    console.log('Starting flow rollback', {
      flowExecutionId,
      stepsToRollback: completedSteps.length,
    });

    // RollbackHandler を使用してロールバック実行
    const rollbackHandler = new RollbackHandler(
      this.tenantId,
      flowExecutionId,
      this.stepRepository
    );

    try {
      await rollbackHandler.rollback(completedSteps);

      // フロー実行ステータスを 'rolled_back' に更新
      const completedAt = Date.now();

      // フロー開始時刻を取得して実行時間を計算
      let duration: number | undefined;
      try {
        const flowExecution = await this.flowRepository.getById(flowExecutionId);
        if (flowExecution) {
          duration = completedAt - flowExecution.startedAt;
        }
      } catch (error) {
        console.error(
          'Failed to get flow execution for duration calculation',
          {
            flowExecutionId,
            error,
          }
        );
      }

      await this.flowRepository.update(flowExecutionId, {
        status: 'rolled_back',
        completedAt,
        duration,
      });

      console.log('Flow execution rolled back successfully', {
        flowExecutionId,
        rolledBackSteps: completedSteps.length,
        duration,
      });
    } catch (error) {
      console.error('Rollback execution failed', {
        flowExecutionId,
        error,
      });

      // ロールバック失敗の場合もステータスを更新（ベストエフォート）
      try {
        await this.flowRepository.update(flowExecutionId, {
          status: 'failed',
          errorDetails: {
            errorCode: 'ROLLBACK_FAILED',
            errorMessage:
              error instanceof Error ? error.message : 'Rollback failed',
            stackTrace: error instanceof Error ? error.stack : undefined,
          },
        });
      } catch (updateError) {
        console.error('Failed to update flow status after rollback failure', {
          flowExecutionId,
          error: updateError,
        });
      }

      throw error;
    }
  }
}
