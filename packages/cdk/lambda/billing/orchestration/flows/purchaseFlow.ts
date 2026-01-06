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
import { IdempotencyRepository } from '../repositories/idempotencyRepository';

/**
 * receiptDataからセッションIDを抽出
 *
 * Stripeの場合: { sessionId: "cs_xxx" } または sessionId文字列
 * Apple/Googleの場合: receiptData自体をハッシュ化してキーとする（将来対応）
 *
 * @param receiptData - レシートデータ
 * @param platformType - プラットフォーム種別
 * @returns セッションID（冪等性キーの一部として使用）
 */
function extractSessionId(receiptData: unknown, platformType: PlatformType): string {
  if (platformType === 'stripe') {
    // Stripeの場合
    if (typeof receiptData === 'string') {
      // JSON文字列の場合はパース
      try {
        const parsed = JSON.parse(receiptData);
        if (parsed.sessionId) {
          return parsed.sessionId;
        }
      } catch {
        // パース失敗時はそのまま使用
        return receiptData;
      }
    } else if (typeof receiptData === 'object' && receiptData !== null) {
      const data = receiptData as Record<string, unknown>;
      if (data.sessionId && typeof data.sessionId === 'string') {
        return data.sessionId;
      }
      if (data.subscriptionId && typeof data.subscriptionId === 'string') {
        return data.subscriptionId;
      }
    }
  }

  // Apple/Googleの場合、またはStripeでsessionIdが見つからない場合
  // receiptData全体をJSON文字列化してハッシュ的に使用
  const receiptString = typeof receiptData === 'string'
    ? receiptData
    : JSON.stringify(receiptData);

  // 長すぎる場合は先頭64文字を使用（実運用ではハッシュ関数を使うべき）
  return receiptString.length > 64
    ? receiptString.substring(0, 64)
    : receiptString;
}

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

  // ========================================
  // 1. 冪等性チェック（フロー開始前に実行）
  // ========================================
  // IdempotencyRepositoryはtenantIdを使用してテナント固有のテーブルにアクセス
  const idempotencyRepo = new IdempotencyRepository(tenantId);
  const sessionId = extractSessionId(receiptData, paymentPlatform as PlatformType);
  const idempotencyKey = IdempotencyRepository.generateKey(tenantId, sessionId);

  console.log('Checking idempotency', { idempotencyKey, sessionId });

  const idempotencyResult = await idempotencyRepo.reserveOrGetExisting(idempotencyKey);

  // 既に処理済みの場合は既存の結果を返す
  if (idempotencyResult.alreadyProcessed && idempotencyResult.existingRecord?.result) {
    console.log('Request already processed, returning existing result', {
      idempotencyKey,
      existingStatus: idempotencyResult.existingRecord.status,
    });
    return idempotencyResult.existingRecord.result;
  }

  // 他のリクエストが処理中の場合はエラーを返す
  if (idempotencyResult.inProgress) {
    console.warn('Another request is currently processing this session', {
      idempotencyKey,
    });
    return {
      success: false,
      flowExecutionId: '',
      errorDetails: {
        errorCode: 'CONCURRENT_REQUEST',
        errorMessage: 'Another request is currently processing this session. Please wait and retry.',
      },
    };
  }

  // ========================================
  // 2. クライアントのインスタンス化
  // ========================================
  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();
  const paymentClient = new PaymentGatewayClient();

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: ユーザ認証検証
    // 注: 認証はAPI Gateway + Cognito Authorizer経由で既に完了している前提
    // このフローはUser API層から呼び出され、userIdはCognitoクレームから抽出済み
    {
      stepName: 'verify_user_auth',
      stepType: 'validation',
      executeFunction: async () => {
        console.log('Verifying user authentication', { userId });

        // 認証は呼び出し元（API Gateway + Cognito Authorizer）で完了済み
        // ここでは認証済みであることを前提として処理を継続

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
            tenantId,
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
        console.log('Rolling back create_subscription step', { outputData });

        const subscriptionData = outputData as { subscriptionId?: string };

        if (!subscriptionData?.subscriptionId) {
          console.warn('No subscription ID found for rollback');
          return;
        }

        try {
          await subscriptionClient.updateSubscriptionStatus({
            tenantId,
            subscriptionId: subscriptionData.subscriptionId,
            newStatus: 'rolled_back',
          });

          console.log('Subscription rolled back successfully', {
            subscriptionId: subscriptionData.subscriptionId,
          });
        } catch (error) {
          console.error('Failed to rollback subscription', {
            subscriptionId: subscriptionData.subscriptionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // ロールバック失敗はベストエフォート（エラーをスローしない）
        }
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

        // レシート検証結果から期間を取得
        const receiptResult =
          previousStepResults.verify_receipt as VerifyReceiptResponse;
        const now = Date.now();
        const periodStart = now;
        const periodEnd = receiptResult?.expiresAt
          ? new Date(receiptResult.expiresAt).getTime()
          : now + 30 * 24 * 60 * 60 * 1000; // デフォルト30日後

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionData.subscriptionId,
          validFrom: new Date().toISOString(),
          // validUntilは指定しない（サブスクリプションの期限に従う）
          periodStart,
          periodEnd,
        });

        console.log('Plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      rollbackFunction: async () => {
        console.log('Rolling back apply_plan step');

        // previousStepResultsからsubscriptionIdを取得
        const subscriptionData = previousStepResults.create_subscription as {
          subscriptionId?: string;
        };

        if (!subscriptionData?.subscriptionId) {
          console.warn('No subscription ID found for rollback');
          return;
        }

        try {
          // subscriptionIdをapplicationSourceIdとして渡し、プラン適用を終了
          await planClient.terminatePlanApplication({
            tenantId,
            userId,
            applicationSourceId: subscriptionData.subscriptionId,
          });

          console.log('Plan application terminated successfully', {
            subscriptionId: subscriptionData.subscriptionId,
          });
        } catch (error) {
          console.error('Failed to rollback plan application', {
            subscriptionId: subscriptionData.subscriptionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // ロールバック失敗はベストエフォート（エラーをスローしない）
        }
      },
      retryable: true,
      maxRetries: 3,
    },
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

      const result = await orchestrator.executeStep(flowExecutionId, i, step, {
        previousStepResults,
      });

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
      // grantId: 将来実装時に previousStepResults.grant_permission?.grantId を設定
    };

    await orchestrator.completeFlow(flowExecutionId, output);

    // 冪等性レコードを成功として記録
    await idempotencyRepo.markCompleted(idempotencyKey, flowExecutionId, output);

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
              rollbackError instanceof Error ? rollbackError.stack : undefined,
          });
          // ロールバック失敗はログ出力のみ（フロー失敗は既に記録済み）
        }
      }
    }

    // エラーレスポンスを作成
    const errorOutput: PurchaseFlowOutput = {
      success: false,
      flowExecutionId,
      errorDetails: {
        errorCode: 'FLOW_EXECUTION_ERROR',
        errorMessage: err.message,
      },
    };

    // 冪等性レコードを失敗として記録
    // 同じsessionIdで再度リクエストされた場合、同じエラーを返す（案B）
    await idempotencyRepo.markFailed(idempotencyKey, flowExecutionId, errorOutput);

    return errorOutput;
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
