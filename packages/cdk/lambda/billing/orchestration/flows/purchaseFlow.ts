/**
 * Purchase Flow Orchestration Lambda Handler
 *
 * プラン購入フローを統括するLambda関数。
 * ユーザがプランを購入する一連の処理を制御し、エラー時のロールバックも管理します。
 *
 * 処理ステップ:
 * 1. ユーザ認証検証（Cognitoトークン検証）
 * 2. プラン検証（プランIDの存在確認）
 * 3. レシート検証（決済システムでのレシート検証）
 * 4. サブスクリプション記録（サブスク情報をDBに保存）
 * 5. プラン適用（ユーザにプランを適用）
 * 6. 権限付与（プランに含まれる権限を付与）※将来実装
 *
 * エラーハンドリング:
 * - ステップ4以降で失敗した場合、ロールバック処理を実行
 * - レシート検証失敗時は検証保留状態への遷移（将来実装）
 */

import { FlowOrchestrator } from '../services/flowOrchestrator';
import {
  PurchaseFlowInput,
  PurchaseFlowOutput,
  PlatformType,
} from '../types/flowTypes';
import { StepConfig } from '../types/stepTypes';
import { PlanManagementClient } from '../clients/planManagementClient';
import {
  SubscriptionManagementClient,
  CreateSubscriptionParams,
} from '../clients/subscriptionManagementClient';
import {
  PaymentGatewayClient,
  VerifyReceiptResponse,
} from '../clients/paymentGatewayClient';

/**
 * Purchase Flow Lambda Handler
 *
 * @param event 購入フロー入力パラメータ
 * @returns 購入フロー実行結果
 */
export const handler = async (
  event: PurchaseFlowInput
): Promise<PurchaseFlowOutput> => {
  const { tenantId, userId, planId, paymentPlatform, receiptData } = event;

  console.log('Purchase flow started', {
    tenantId,
    userId,
    planId,
    paymentPlatform,
  });

  // クライアントのインスタンス化
  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();
  const paymentClient = new PaymentGatewayClient();

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: ユーザ認証検証
    {
      stepName: 'verify_user_auth',
      stepType: 'validation',
      executeFunction: async () => {
        console.log('Verifying user authentication', { userId });

        // TODO: Cognitoトークンの検証を実装
        // 現時点ではLambda関数の呼び出し元で認証済みと仮定
        // 将来的にはCognitoトークンを検証する処理を追加

        return {
          authenticated: true,
          userId,
        };
      },
      retryable: false,
      maxRetries: 0,
    },

    // ステップ2: プラン検証
    {
      stepName: 'validate_plan',
      stepType: 'validation',
      executeFunction: async () => {
        console.log('Validating plan', { tenantId, planId });

        // TODO: プラン管理責務のInternal関数でプランの存在確認を実装
        // 現時点では簡易的な検証として、planIdが存在することを確認
        if (!planId || planId.trim() === '') {
          throw new Error('Invalid plan ID');
        }

        return {
          planExists: true,
          planId,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: レシート検証
    {
      stepName: 'verify_receipt',
      stepType: 'api_call',
      targetService: 'PaymentGateway',
      targetFunction: process.env.PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Verifying receipt', { paymentPlatform });

        try {
          const result = await paymentClient.verifyReceipt({
            platformType: paymentPlatform as PlatformType,
            receipt: JSON.stringify(receiptData),
          });

          if (!result.isValid) {
            console.error('Receipt verification failed', { result });
            throw new Error('Receipt verification failed: invalid receipt');
          }

          console.log('Receipt verification succeeded', {
            platformSubscriptionId: result.platformSubscriptionId,
            expiresAt: result.expiresAt,
          });

          return result;
        } catch (error) {
          console.error('Receipt verification error', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // レシート検証失敗時は検証保留パターンへ遷移（将来実装）
          // 現時点ではエラーをスローして失敗とする
          throw error;
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: サブスクリプション記録
    {
      stepName: 'create_subscription',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Creating subscription', { tenantId, userId, planId });

        const receiptResult =
          previousStepResults.verify_receipt as VerifyReceiptResponse;

        if (!receiptResult?.platformSubscriptionId) {
          throw new Error(
            'Platform subscription ID not found in receipt verification result'
          );
        }

        const params: CreateSubscriptionParams = {
          tenantId,
          userId,
          planId,
          platformType: paymentPlatform as PlatformType,
          platformSubscriptionId: receiptResult.platformSubscriptionId,
          subscriptionStatus: 'active',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd:
            receiptResult.expiresAt || getDefaultExpirationDate(),
        };

        const result = await subscriptionClient.createSubscription(params);

        console.log('Subscription created successfully', {
          subscriptionId: result.subscriptionId,
          status: result.status,
        });

        return result;
      },
      rollbackFunction: async (outputData: unknown) => {
        // サブスクリプション削除のロールバック処理（将来実装）
        // 現時点ではログ出力のみ
        console.log('Rolling back create_subscription step', { outputData });

        // TODO: subscriptionManagementClient.deleteSubscription() を呼び出す
        // 現時点では削除機能が未実装のため、ログのみ出力
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ5: プラン適用
    {
      stepName: 'apply_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Applying plan to user', { tenantId, userId, planId });

        const subscriptionData = previousStepResults.create_subscription as {
          subscriptionId: string;
        };

        if (!subscriptionData?.subscriptionId) {
          throw new Error('Subscription ID not found in previous step result');
        }

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionData.subscriptionId,
          validFrom: new Date().toISOString(),
          // validUntilは指定しない（サブスクリプションの期限に従う）
        });

        console.log('Plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      rollbackFunction: async (outputData: unknown) => {
        console.log('Rolling back apply_plan step', { outputData });

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

          console.log('Plan application terminated successfully', {
            applicationId: planApplicationData.applicationId,
          });
        } catch (error) {
          console.error('Failed to rollback plan application', {
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
    //   stepName: 'grant_permission',
    //   stepType: 'api_call',
    //   targetService: 'AuthorizationService',
    //   targetFunction: process.env.AUTHORIZATION_SERVICE_GRANT_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Granting permissions', { tenantId, userId, planId });
    //
    //     // TODO: AuthorizationServiceClientを実装後、権限付与処理を追加
    //     return { grantId: 'grant-placeholder' };
    //   },
    //   rollbackFunction: async (outputData: unknown) => {
    //     console.log('Rolling back grant_permission step', { outputData });
    //     // TODO: AuthorizationServiceClient.revokePermission() を実装
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
      'purchase',
      userId,
      userId, // initiatedBy: ユーザ自身が開始
      event,
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
    const subscriptionData = previousStepResults.create_subscription as {
      subscriptionId: string;
    };
    const planApplicationData = previousStepResults.apply_plan as {
      applicationId: string;
    };

    const output: PurchaseFlowOutput = {
      success: true,
      flowExecutionId,
      subscriptionId: subscriptionData?.subscriptionId,
      grantId: undefined, // 将来実装: previousStepResults.grant_permission?.grantId
    };

    await orchestrator.completeFlow(flowExecutionId, output);

    console.log('Purchase flow completed successfully', {
      flowExecutionId,
      subscriptionId: output.subscriptionId,
    });

    return output;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error('Purchase flow execution failed', {
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

      // ロールバック実行
      if (completedSteps.length > 0) {
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
      }
    }

    // エラーレスポンスを返す
    return {
      success: false,
      flowExecutionId,
      errorDetails: {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
      },
    };
  }
};

/**
 * デフォルトの有効期限を取得（30日後）
 *
 * @returns ISO 8601形式の日時文字列
 */
function getDefaultExpirationDate(): string {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 30);
  return expirationDate.toISOString();
}
