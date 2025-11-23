/**
 * Cancellation Flow Orchestration Lambda Handler
 *
 * 解約フローを統括するLambda関数。
 * ユーザがプランを解約する一連の処理を制御し、エラー時のロールバックも管理します。
 *
 * 処理ステップ（即時解約の場合）:
 * 1. 決済システムへの解約依頼（paymentGatewayClient.cancelSubscription、at_period_end: false）
 * 2. サブスクリプション情報更新（status: 'canceled'）
 * 3. プラン適用終了（planManagementClient.terminatePlanApplication、immediate: true）
 * 4. 権限剥奪（プラン管理内で実施される想定、将来実装）
 * 5. デフォルトプランへの遷移（planManagementClient.applyPlanToUser、'free'プラン適用）
 * 6. 通知送信（将来実装）
 *
 * 処理ステップ（期限終了時解約の場合）:
 * 1. 決済システムへの自動更新停止依頼（paymentGatewayClient.cancelSubscription、at_period_end: true）
 * 2. サブスクリプション情報更新（status: 'scheduled_cancellation'）
 * 3. プラン適用状態更新（planManagementClient.updatePlanApplicationStatus、status: 'scheduled_termination'）
 * 4. 通知送信（将来実装）
 *
 * エラーハンドリング:
 * - ステップ1で失敗した場合、最大3回リトライ
 * - ステップ2以降で失敗した場合、手動対応として管理者アラート（ログに記録）
 */

import { FlowOrchestrator } from '../services/flowOrchestrator';
import {
  CancellationFlowInput,
  CancellationFlowOutput,
  CancellationType,
  PlatformType,
} from '../types/flowTypes';
import { StepConfig } from '../types/stepTypes';
import { PlanManagementClient } from '../clients/planManagementClient';
import {
  SubscriptionManagementClient,
  UpdateSubscriptionStatusParams,
} from '../clients/subscriptionManagementClient';
import { PaymentGatewayClient } from '../clients/paymentGatewayClient';
import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';

/**
 * デフォルトプランを取得
 * データベースからis_default=trueのプランを取得する
 *
 * @param tenantId テナントID
 * @returns デフォルトプランのID
 * @throws エラー（デフォルトプランが設定されていない場合）
 */
async function getDefaultPlanId(tenantId: string): Promise<string> {
  console.log('Getting default plan from database', { tenantId });

  try {
    const defaultPlan = await invokeDataAccessFunctionByTenantId<Plan | null>(
      tenantId,
      'plan',
      'getDefaultPlan',
      {}
    );

    if (!defaultPlan) {
      throw new Error('Default plan is not configured. Please configure a default plan in the system.');
    }

    console.log('Default plan found', {
      planId: defaultPlan.plan_id,
      internalName: defaultPlan.internal_name
    });

    return defaultPlan.plan_id;
  } catch (error) {
    console.error('Failed to get default plan', { tenantId, error });
    throw error;
  }
}

/**
 * サブスクリプション情報から決済プラットフォームを取得
 *
 * TODO: 実際の実装では subscriptionManagementClient.getSubscription() を呼び出して取得
 * 現時点では仮でstripeを返す
 *
 * @param subscriptionId サブスクリプションID
 * @returns 決済プラットフォーム
 */
async function getPlatformFromSubscription(
  subscriptionId: string
): Promise<PlatformType> {
  console.log('Getting platform from subscription', { subscriptionId });

  // TODO: subscriptionManagementClient.getSubscription() を実装後、実際の取得処理に置き換える
  // 現時点では仮でstripeを返す
  return 'stripe';
}

/**
 * 解約有効日時を計算
 *
 * @param cancellationType 解約タイプ
 * @returns 解約有効日時（ISO 8601形式）
 */
function calculateEffectiveDate(cancellationType: CancellationType): string {
  if (cancellationType === 'immediate') {
    // 即時解約は現在時刻
    return new Date().toISOString();
  } else {
    // 期限終了時解約は次回更新日（仮で30日後に設定）
    // TODO: 実際の実装では、サブスクリプション情報から次回更新日を取得する
    const effectiveDate = new Date();
    effectiveDate.setDate(effectiveDate.getDate() + 30);
    return effectiveDate.toISOString();
  }
}

/**
 * 現在のプラン適用IDを取得
 *
 * TODO: 実際の実装では planManagementClient から取得する処理を実装
 * 現時点では仮のIDを返す
 *
 * @param userId ユーザID
 * @param subscriptionId サブスクリプションID
 * @returns プラン適用ID
 */
async function getCurrentPlanApplicationId(
  userId: string,
  subscriptionId: string
): Promise<string> {
  console.log('Getting current plan application ID', { userId, subscriptionId });

  // TODO: planManagementClientで現在のプラン適用IDを取得する処理を実装
  // 現時点では仮のIDを返す
  return `app-${userId}-${subscriptionId}`;
}

/**
 * Cancellation Flow Lambda Handler
 *
 * @param event 解約フロー入力パラメータ
 * @returns 解約フロー実行結果
 */
export const handler = async (
  event: CancellationFlowInput
): Promise<CancellationFlowOutput> => {
  const { tenantId, userId, subscriptionId, cancellationType, reason } = event;

  console.log('Cancellation flow started', {
    tenantId,
    userId,
    subscriptionId,
    cancellationType,
    reason,
  });

  // 解約理由をログに記録
  if (reason) {
    console.log('Cancellation reason', { userId, subscriptionId, reason });
  }

  // クライアントのインスタンス化
  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();
  const paymentClient = new PaymentGatewayClient();

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // 解約タイプに応じてステップ設定を分岐
  const steps: StepConfig[] =
    cancellationType === 'immediate'
      ? buildImmediateCancellationSteps(
          tenantId,
          userId,
          subscriptionId,
          planClient,
          subscriptionClient,
          paymentClient,
          previousStepResults
        )
      : buildAtPeriodEndCancellationSteps(
          tenantId,
          userId,
          subscriptionId,
          planClient,
          subscriptionClient,
          paymentClient,
          previousStepResults
        );

  // フロー実行開始
  let flowExecutionId = '';
  const completedSteps: Array<{
    stepSequence: number;
    stepConfig: StepConfig;
    outputData: unknown;
  }> = [];

  try {
    flowExecutionId = await orchestrator.startFlow(
      'cancellation',
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
    const effectiveDate = calculateEffectiveDate(cancellationType);

    const output: CancellationFlowOutput = {
      success: true,
      flowExecutionId,
      cancellationType,
      effectiveDate,
    };

    await orchestrator.completeFlow(
      flowExecutionId,
      output as unknown as Record<string, unknown>
    );

    console.log('Cancellation flow completed successfully', {
      flowExecutionId,
      cancellationType,
      effectiveDate,
    });

    return output;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error('Cancellation flow execution failed', {
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

      // 即時解約の場合のみロールバック実行
      // 期限終了時解約の場合は、既に決済システムで予約解約が設定されているため、
      // ロールバックは手動対応として管理者アラート（ログに記録）のみ行う
      if (cancellationType === 'immediate' && completedSteps.length > 0) {
        console.log('Starting rollback process', {
          stepsToRollback: completedSteps.length,
        });

        try {
          await orchestrator.rollbackFlow(flowExecutionId, completedSteps);
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
      } else if (cancellationType === 'at_period_end') {
        console.error(
          'MANUAL_INTERVENTION_REQUIRED: At period end cancellation failed. Administrator action needed.',
          {
            flowExecutionId,
            userId,
            subscriptionId,
            completedSteps: completedSteps.map((s) => s.stepConfig.stepName),
          }
        );
      }
    }

    // エラーレスポンスを返す
    return {
      success: false,
      flowExecutionId,
      cancellationType,
      effectiveDate: calculateEffectiveDate(cancellationType),
      errorDetails: {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
      },
    };
  }
};

/**
 * 即時解約のステップ設定を構築
 *
 * @param tenantId テナントID
 * @param userId ユーザID
 * @param subscriptionId サブスクリプションID
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @param paymentClient 決済ゲートウェイクライアント
 * @param previousStepResults 前のステップの結果を保持する変数
 * @returns ステップ設定の配列
 */
function buildImmediateCancellationSteps(
  tenantId: string,
  userId: string,
  subscriptionId: string,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient,
  paymentClient: PaymentGatewayClient,
  previousStepResults: Record<string, unknown>
): StepConfig[] {
  return [
    // ステップ1: 決済システムへの解約依頼（即時解約）
    {
      stepName: 'cancel_payment_subscription',
      stepType: 'api_call',
      targetService: 'PaymentGateway',
      targetFunction:
        process.env.PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Canceling payment subscription (immediate)', {
          subscriptionId,
        });

        // サブスクリプション情報から決済プラットフォームを取得
        const platform = await getPlatformFromSubscription(subscriptionId);

        try {
          const result = await paymentClient.cancelSubscription({
            platform,
            subscriptionId,
            atPeriodEnd: false, // 即時解約
          });

          console.log('Payment subscription canceled successfully', {
            subscriptionId,
            success: result.success,
          });

          return {
            success: result.success,
            platform,
          };
        } catch (error) {
          console.error('Failed to cancel payment subscription', {
            subscriptionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // 決済システムへの解約依頼失敗はフロー全体の失敗
          throw error;
        }
      },
      retryable: true,
      maxRetries: 3, // 仕様書の要件: ステップ1で失敗した場合は最大3回リトライ
    },

    // ステップ2: サブスクリプション情報更新（status: 'canceled'）
    {
      stepName: 'update_subscription_to_canceled',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating subscription status to canceled', {
          tenantId,
          subscriptionId,
        });

        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId,
          newStatus: 'canceled',
        };

        const result = await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Subscription status updated to canceled', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: プラン適用終了（即時終了）
    {
      stepName: 'terminate_plan_application',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Terminating plan application (immediate)', {
          tenantId,
          userId,
        });

        // 現在のプラン適用IDを取得
        const planApplicationId = await getCurrentPlanApplicationId(
          userId,
          subscriptionId
        );

        try {
          const result = await planClient.terminatePlanApplication({
            tenantId,
            userId,
            planApplicationId,
            immediate: true, // 即時終了
          });

          console.log('Plan application terminated successfully', {
            planApplicationId,
            success: result.success,
          });

          return {
            planApplicationId,
            success: result.success,
          };
        } catch (error) {
          console.error('Failed to terminate plan application', {
            planApplicationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // このステップの失敗は手動対応として管理者アラート
          console.error(
            'MANUAL_INTERVENTION_REQUIRED: Failed to terminate plan application',
            {
              userId,
              subscriptionId,
              planApplicationId,
            }
          );

          throw error;
        }
      },
      rollbackFunction: async (outputData: unknown) => {
        console.log('Rolling back terminate_plan_application step', {
          outputData,
        });

        // プラン適用終了のロールバック（プラン再適用）
        // TODO: 実際には終了前の状態を復元する処理を実装
        // 現時点ではログ出力のみ
        console.log('Plan application termination rollback required', {
          userId,
          subscriptionId,
        });
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: 権限剥奪（プラン管理内で実施される想定、将来実装）
    // プラン適用終了時にプラン管理内で自動的に権限剥奪が実施されるため、
    // 統括責務では明示的なステップとしては実装しない
    // （将来、権限管理が独立した責務になった場合は、ここに追加する）

    // ステップ5: デフォルトプランへの遷移
    {
      stepName: 'apply_default_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        // データベースからデフォルトプランを取得
        const defaultPlanId = await getDefaultPlanId(tenantId);

        console.log('Applying default plan to user', {
          tenantId,
          userId,
          planId: defaultPlanId,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId: defaultPlanId,
          applicationSource: 'default',
          applicationSourceId: undefined,
          validFrom: new Date().toISOString(),
          // validUntilは指定しない（無期限の無料プラン）
        });

        console.log('Default plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      rollbackFunction: async (outputData: unknown) => {
        console.log('Rolling back apply_default_plan step', { outputData });

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

          console.log('Default plan application terminated successfully', {
            applicationId: planApplicationData.applicationId,
          });
        } catch (error) {
          console.error('Failed to rollback default plan application', {
            applicationId: planApplicationData.applicationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // ロールバック失敗はベストエフォート（エラーをスローしない）
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ6: 通知送信（将来実装）
    // {
    //   stepName: 'send_cancellation_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending cancellation notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },
  ];
}

/**
 * 期限終了時解約のステップ設定を構築
 *
 * @param tenantId テナントID
 * @param userId ユーザID
 * @param subscriptionId サブスクリプションID
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @param paymentClient 決済ゲートウェイクライアント
 * @param previousStepResults 前のステップの結果を保持する変数
 * @returns ステップ設定の配列
 */
function buildAtPeriodEndCancellationSteps(
  tenantId: string,
  userId: string,
  subscriptionId: string,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient,
  paymentClient: PaymentGatewayClient,
  previousStepResults: Record<string, unknown>
): StepConfig[] {
  return [
    // ステップ1: 決済システムへの自動更新停止依頼（期限終了時解約）
    {
      stepName: 'cancel_payment_subscription_at_period_end',
      stepType: 'api_call',
      targetService: 'PaymentGateway',
      targetFunction:
        process.env.PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Canceling payment subscription (at period end)', {
          subscriptionId,
        });

        // サブスクリプション情報から決済プラットフォームを取得
        const platform = await getPlatformFromSubscription(subscriptionId);

        try {
          const result = await paymentClient.cancelSubscription({
            platform,
            subscriptionId,
            atPeriodEnd: true, // 期限終了時解約
          });

          console.log(
            'Payment subscription scheduled for cancellation at period end',
            {
              subscriptionId,
              success: result.success,
            }
          );

          return {
            success: result.success,
            platform,
          };
        } catch (error) {
          console.error('Failed to schedule subscription cancellation', {
            subscriptionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // 決済システムへの解約依頼失敗はフロー全体の失敗
          throw error;
        }
      },
      retryable: true,
      maxRetries: 3, // 仕様書の要件: ステップ1で失敗した場合は最大3回リトライ
    },

    // ステップ2: サブスクリプション情報更新（status: 'scheduled_cancellation'）
    {
      stepName: 'update_subscription_to_scheduled_cancellation',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating subscription status to scheduled_cancellation', {
          tenantId,
          subscriptionId,
        });

        // TODO: scheduled_cancellationステータスをSubscriptionManagementに追加する必要がある
        // 現時点では仮でactiveを使用（将来的にstatusの型定義を拡張）
        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId,
          newStatus: 'active', // TODO: 'scheduled_cancellation' に変更
        };

        const result = await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Subscription status updated to scheduled_cancellation', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: プラン適用状態更新（status: 'scheduled_termination'）
    {
      stepName: 'update_plan_application_to_scheduled_termination',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating plan application status to scheduled_termination', {
          tenantId,
          userId,
        });

        // 現在のプラン適用IDを取得
        const planApplicationId = await getCurrentPlanApplicationId(
          userId,
          subscriptionId
        );

        try {
          const result = await planClient.updatePlanApplicationStatus({
            tenantId,
            planApplicationId,
            status: 'scheduled_termination',
          });

          console.log('Plan application status updated to scheduled_termination', {
            planApplicationId,
            success: result.success,
          });

          return {
            planApplicationId,
            success: result.success,
          };
        } catch (error) {
          console.error('Failed to update plan application status', {
            planApplicationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // このステップの失敗は手動対応として管理者アラート
          console.error(
            'MANUAL_INTERVENTION_REQUIRED: Failed to update plan application status',
            {
              userId,
              subscriptionId,
              planApplicationId,
            }
          );

          throw error;
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: 通知送信（将来実装）
    // {
    //   stepName: 'send_scheduled_cancellation_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending scheduled cancellation notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },

    // 注: 期限終了時解約では権限の剥奪は行わない（期限まで利用可能）
    // 期限到達時に定期バッチ処理により権限剥奪とデフォルトプラン遷移が実行される
  ];
}
