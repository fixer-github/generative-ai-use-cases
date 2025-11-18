/**
 * Plan Change Flow Orchestration Lambda Handler
 *
 * プラン変更フローを統括するLambda関数。
 * ユーザがプランを変更する一連の処理を制御し、エラー時のロールバックも管理します。
 *
 * 処理ステップ:
 * 1. プラン比較（アップグレード/ダウングレード判定）
 * 2. 決済システムへのプラン変更依頼（paymentGatewayClient.updateSubscription）
 *    - アップグレード: prorate=true（即座に変更）
 *    - ダウングレード: prorate=false（次回更新時に変更）
 * 3. サブスクリプション情報更新（subscriptionManagementClient.updateSubscriptionStatus）
 * 4. 古いプランの権限剥奪（planManagementClient.terminatePlanApplication）
 * 5. 新しいプラン適用（planManagementClient.applyPlanToUser）
 * 6. 権限付与（将来実装）
 * 7. 通知送信（将来実装）
 *
 * エラーハンドリング:
 * - ステップ4、5で失敗した場合、古いプランの権限を再付与するロールバック処理
 * - ステップ2で失敗した場合、決済システム側でトランザクションが保証される前提のため、エラーとして記録
 */

import { FlowOrchestrator } from '../services/flowOrchestrator';
import {
  PlanChangeFlowInput,
  PlanChangeFlowOutput,
  PlanChangeType,
  PlatformType,
} from '../types/flowTypes';
import { StepConfig } from '../types/stepTypes';
import { PlanManagementClient } from '../clients/planManagementClient';
import {
  SubscriptionManagementClient,
  UpdateSubscriptionStatusParams,
} from '../clients/subscriptionManagementClient';
import { PaymentGatewayClient } from '../clients/paymentGatewayClient';

/**
 * プランレベル定義
 * プランIDからレベルを判定するためのマッピング
 */
const PLAN_LEVELS: Record<string, number> = {
  free: 1,
  basic: 2,
  standard: 3,
  premium: 4,
  enterprise: 5,
};

/**
 * プランレベルを取得
 *
 * @param planId プランID
 * @returns プランレベル（数値）
 */
function getPlanLevel(planId: string): number {
  // プランIDからプレフィックスを除去して正規化（例: "plan-standard" -> "standard"）
  const normalizedPlanId = planId.toLowerCase().replace(/^plan-?/, '');

  // マッピングからレベルを取得
  const level = PLAN_LEVELS[normalizedPlanId];

  if (level === undefined) {
    console.warn(`Unknown plan ID: ${planId}, treating as level 0`);
    return 0;
  }

  return level;
}

/**
 * プラン変更タイプを判定
 *
 * @param currentPlanId 現在のプランID
 * @param newPlanId 新しいプランID
 * @returns プラン変更タイプ（upgrade/downgrade）
 * @throws Error 同一プランへの変更の場合
 */
function determineChangeType(
  currentPlanId: string,
  newPlanId: string
): PlanChangeType {
  const currentLevel = getPlanLevel(currentPlanId);
  const newLevel = getPlanLevel(newPlanId);

  if (currentLevel === newLevel) {
    throw new Error(
      `Cannot change to the same plan level: ${currentPlanId} -> ${newPlanId}`
    );
  }

  return newLevel > currentLevel ? 'upgrade' : 'downgrade';
}

/**
 * 有効日時を計算
 *
 * @param changeType プラン変更タイプ
 * @returns 有効日時（ISO 8601形式）
 */
function calculateEffectiveDate(changeType: PlanChangeType): string {
  if (changeType === 'upgrade') {
    // アップグレードは即座に有効
    return new Date().toISOString();
  } else {
    // ダウングレードは次回更新時に有効（仮で30日後に設定）
    // 実際の実装では、サブスクリプション情報から次回更新日を取得する
    const effectiveDate = new Date();
    effectiveDate.setDate(effectiveDate.getDate() + 30);
    return effectiveDate.toISOString();
  }
}

/**
 * Plan Change Flow Lambda Handler
 *
 * @param event プラン変更フロー入力パラメータ
 * @returns プラン変更フロー実行結果
 */
export const handler = async (
  event: PlanChangeFlowInput
): Promise<PlanChangeFlowOutput> => {
  const { tenantId, userId, currentPlanId, newPlanId, subscriptionId } = event;

  console.log('Plan change flow started', {
    tenantId,
    userId,
    currentPlanId,
    newPlanId,
    subscriptionId,
  });

  // クライアントのインスタンス化
  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();
  const paymentClient = new PaymentGatewayClient();

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // プラン変更タイプを判定
  let changeType: PlanChangeType;

  try {
    changeType = determineChangeType(currentPlanId, newPlanId);
    console.log('Plan change type determined', { changeType });
  } catch (error) {
    console.error('Failed to determine plan change type', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      flowExecutionId: '',
      changeType: 'upgrade', // デフォルト値
      effectiveDate: new Date().toISOString(),
      errorDetails: {
        errorCode: 'INVALID_PLAN_CHANGE',
        errorMessage:
          error instanceof Error ? error.message : 'Invalid plan change',
      },
    };
  }

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: プラン比較（アップグレード/ダウングレード判定）
    {
      stepName: 'compare_plans',
      stepType: 'validation',
      executeFunction: async () => {
        console.log('Comparing plans', {
          currentPlanId,
          newPlanId,
          changeType,
        });

        // プラン比較結果を返す
        return {
          currentPlanId,
          newPlanId,
          changeType,
          currentLevel: getPlanLevel(currentPlanId),
          newLevel: getPlanLevel(newPlanId),
        };
      },
      retryable: false,
      maxRetries: 0,
    },

    // ステップ2: 決済システムへのプラン変更依頼
    {
      stepName: 'update_payment_subscription',
      stepType: 'api_call',
      targetService: 'PaymentGateway',
      targetFunction:
        process.env.PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating payment subscription', {
          subscriptionId,
          newPlanId,
          prorate: changeType === 'upgrade',
        });

        // TODO: サブスクリプション情報から決済プラットフォームを取得
        // 現時点では仮でstripeを使用
        const platform: PlatformType = 'stripe';

        try {
          const result = await paymentClient.updateSubscription({
            platform,
            subscriptionId,
            newPlanId,
            prorate: changeType === 'upgrade', // アップグレードは即座、ダウングレードは次回更新時
          });

          console.log('Payment subscription updated successfully', {
            subscriptionId,
            success: result.success,
          });

          return {
            success: result.success,
            platform,
          };
        } catch (error) {
          console.error('Failed to update payment subscription', {
            subscriptionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // 決済システムへの変更依頼失敗はフロー全体の失敗
          throw error;
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: サブスクリプション情報更新
    {
      stepName: 'update_subscription_status',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating subscription status', {
          tenantId,
          subscriptionId,
          changeType,
        });

        // アップグレードは即座にactive、ダウングレードは次回更新時に変更されるためactive維持
        const newStatus: UpdateSubscriptionStatusParams['newStatus'] = 'active';

        const result = await subscriptionClient.updateSubscriptionStatus({
          tenantId,
          subscriptionId,
          newStatus,
        });

        console.log('Subscription status updated successfully', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: 古いプランの権限剥奪
    {
      stepName: 'terminate_old_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Terminating old plan application', {
          tenantId,
          userId,
          currentPlanId,
        });

        // TODO: 現在のプラン適用IDを取得する処理を実装
        // 現時点では仮のIDを使用
        const planApplicationId = `app-${userId}-${currentPlanId}`;

        try {
          const result = await planClient.terminatePlanApplication({
            tenantId,
            userId,
            planApplicationId,
            immediate: changeType === 'upgrade', // アップグレードは即座、ダウングレードは次回更新時
          });

          console.log('Old plan application terminated successfully', {
            planApplicationId,
            success: result.success,
          });

          return {
            planApplicationId,
            success: result.success,
          };
        } catch (error) {
          console.error('Failed to terminate old plan application', {
            planApplicationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // このステップの失敗はロールバック対象
          throw error;
        }
      },
      rollbackFunction: async (outputData: unknown) => {
        console.log('Rolling back terminate_old_plan step', { outputData });

        // 古いプランの権限を再付与（ロールバック）
        // TODO: 実際には古いプラン適用を再有効化する処理を実装
        // 現時点ではログ出力のみ
        console.log('Old plan application rollback required', {
          currentPlanId,
        });
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ5: 新しいプラン適用
    {
      stepName: 'apply_new_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Applying new plan to user', {
          tenantId,
          userId,
          newPlanId,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId: newPlanId,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionId,
          validFrom:
            changeType === 'upgrade'
              ? new Date().toISOString()
              : calculateEffectiveDate(changeType),
          // validUntilは指定しない（サブスクリプションの期限に従う）
        });

        console.log('New plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      rollbackFunction: async (outputData: unknown) => {
        console.log('Rolling back apply_new_plan step', { outputData });

        const planApplicationData = outputData as {
          applicationId?: string;
        };

        if (!planApplicationData?.applicationId) {
          console.warn('No application ID found for rollback');
          return;
        }

        try {
          await planClient.terminatePlanApplication({
            tenantId,
            userId,
            planApplicationId: planApplicationData.applicationId,
            immediate: true,
          });

          console.log('New plan application terminated successfully', {
            applicationId: planApplicationData.applicationId,
          });

          // 古いプランの権限を再付与
          console.log('Re-applying old plan', { currentPlanId });

          await planClient.applyPlanToUser({
            tenantId,
            userId,
            planId: currentPlanId,
            applicationSource: 'subscription',
            applicationSourceId: subscriptionId,
            validFrom: new Date().toISOString(),
          });

          console.log('Old plan re-applied successfully', { currentPlanId });
        } catch (error) {
          console.error('Failed to rollback new plan application', {
            applicationId: planApplicationData.applicationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // ロールバック失敗はベストエフォート（エラーをスローしない）
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ6: 権限付与（将来実装）
    // {
    //   stepName: 'grant_new_permissions',
    //   stepType: 'api_call',
    //   targetService: 'AuthorizationService',
    //   targetFunction: process.env.AUTHORIZATION_SERVICE_GRANT_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Granting new permissions', { tenantId, userId, newPlanId });
    //
    //     // TODO: AuthorizationServiceClientを実装後、権限付与処理を追加
    //     return { grantId: 'grant-placeholder' };
    //   },
    //   rollbackFunction: async (outputData: unknown) => {
    //     console.log('Rolling back grant_new_permissions step', { outputData });
    //     // TODO: AuthorizationServiceClient.revokePermission() を実装
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },

    // ステップ7: 通知送信（将来実装）
    // {
    //   stepName: 'send_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending plan change notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },
  ];

  // フロー実行開始
  let flowExecutionId = '';
  const completedSteps: Array<{
    stepSequence: number;
    stepConfig: StepConfig;
    outputData: unknown;
  }> = [];

  try {
    flowExecutionId = await orchestrator.startFlow(
      'plan_change',
      userId,
      userId, // initiatedBy: ユーザ自身が開始
      event as unknown as Record<string, unknown>,
      steps.length
    );

    console.log('Flow execution started', { flowExecutionId });

    // 各ステップを順次実行
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      console.log(`Executing step ${i + 1}/${steps.length}: ${step.stepName}`);

      const result = await orchestrator.executeStep(
        flowExecutionId,
        i,
        step,
        { previousStepResults }
      );

      if (!result.success) {
        console.error(`Step ${step.stepName} failed`);
        throw new Error(`Step ${step.stepName} failed`);
      }

      // 完了ステップを記録（ロールバック用）
      completedSteps.push({
        stepSequence: i,
        stepConfig: step,
        outputData: result.outputData,
      });

      // 次のステップ用に結果を保存
      previousStepResults[step.stepName] = result.outputData;

      console.log(`Step ${step.stepName} completed successfully`);
    }

    // フロー完了
    const effectiveDate = calculateEffectiveDate(changeType);

    const output: PlanChangeFlowOutput = {
      success: true,
      flowExecutionId,
      changeType,
      effectiveDate,
    };

    await orchestrator.completeFlow(
      flowExecutionId,
      output as unknown as Record<string, unknown>
    );

    console.log('Plan change flow completed successfully', {
      flowExecutionId,
      changeType,
      effectiveDate,
    });

    return output;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error('Plan change flow execution failed', {
      flowExecutionId,
      error: err.message,
      stack: err.stack,
    });

    // フロー失敗を記録
    if (flowExecutionId) {
      await orchestrator.failFlow(flowExecutionId, {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
        stackTrace: err.stack,
      });

      // ロールバック実行（ステップ4以降で失敗した場合のみ）
      // ステップ4: terminate_old_plan、ステップ5: apply_new_plan
      const rollbackableSteps = completedSteps.filter(
        (step) =>
          step.stepConfig.stepName === 'terminate_old_plan' ||
          step.stepConfig.stepName === 'apply_new_plan'
      );

      if (rollbackableSteps.length > 0) {
        console.log('Starting rollback process', {
          stepsToRollback: rollbackableSteps.length,
        });

        try {
          await orchestrator.rollbackFlow(flowExecutionId, rollbackableSteps);
          console.log('Rollback completed successfully');
        } catch (rollbackError) {
          console.error('Rollback failed', {
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : 'Unknown error',
            stack:
              rollbackError instanceof Error
                ? rollbackError.stack
                : undefined,
          });
          // ロールバック失敗はログ出力のみ（フロー失敗は既に記録済み）
        }
      }
    }

    // エラーレスポンスを返す
    return {
      success: false,
      flowExecutionId,
      changeType,
      effectiveDate: calculateEffectiveDate(changeType),
      errorDetails: {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
      },
    };
  }
};
