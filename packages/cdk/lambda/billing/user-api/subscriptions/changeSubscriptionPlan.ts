/**
 * User-facing Change Subscription Plan API
 *
 * ユーザ向けのプラン変更API。
 * 現在のサブスクリプションから新しいプランへの変更を処理します。
 * アップグレードは即座に、ダウングレードは次回更新時に適用されます。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  ok200Response,
  unauthorized401Response,
  badRequest400Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  PlanChangeFlowInput,
  PlanChangeFlowOutput,
} from '../../orchestration/types/flowTypes';
import { UserPlanApplication } from '../../data-access/repositories/types';

/**
 * リクエストボディの型
 */
interface ChangeSubscriptionPlanRequest {
  /** 変更先のプランID */
  newPlanId: string;
  /** サブスクリプションID */
  subscriptionId: string;
}

/**
 * レスポンスボディの型
 */
interface ChangeSubscriptionPlanResponse {
  /** 成功フラグ */
  success: boolean;
  /** フロー実行ID */
  flowExecutionId: string;
  /** プラン変更タイプ（upgrade/downgrade） */
  changeType: 'upgrade' | 'downgrade';
  /** 新しいプランID */
  newPlanId: string;
  /** 変更が有効になる日時 */
  effectiveDate: string;
  /** メッセージ */
  message: string;
}

/**
 * エラーレスポンスの型
 */
interface ErrorResponse {
  message: string;
  code: string;
  details?: unknown;
}

// Lambda client instance
const lambdaClient = new LambdaClient({});

/**
 * 最も優先度の高いプラン適用を選択する関数
 */
function getApplicationPriority(
  source: UserPlanApplication['application_source']
): number {
  const priorities = {
    subscription: 5,
    manual: 4,
    campaign: 3,
    trial: 2,
    default: 1,
  };
  return priorities[source] || 0;
}

function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  const sorted = [...applications].sort((a, b) => {
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return sorted[0];
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Change Subscription Plan request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    let requestBody: ChangeSubscriptionPlanRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { newPlanId, subscriptionId } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!newPlanId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'newPlanId',
          reason: 'newPlanIdは必須です',
        },
      });
    }

    if (!subscriptionId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'subscriptionId',
          reason: 'subscriptionIdは必須です',
        },
      });
    }

    // 4. 現在のプランIDを取得
    let applications: UserPlanApplication[];
    try {
      applications = await invokeDataAccessFunction<UserPlanApplication[]>(
        event,
        'user-plan-application',
        'findActiveByUserId',
        { userId }
      );
    } catch (error) {
      console.error('Error fetching user plan applications:', error);
      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      if (!['active', 'scheduled_termination'].includes(app.application_status)) {
        return false;
      }
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }
      return true;
    });

    // 最も優先度の高いプラン適用を選択
    const highestPriorityApplication = selectHighestPriorityApplication(activeApplications);

    if (!highestPriorityApplication) {
      return badRequest400Response({
        message: '現在有効なプランがありません',
        code: 'NO_ACTIVE_PLAN',
      });
    }

    const currentPlanId = highestPriorityApplication.plan_id;

    // 5. 同じプランへの変更をチェック
    if (currentPlanId === newPlanId) {
      return badRequest400Response({
        message: '同じプランへの変更はできません',
        code: 'SAME_PLAN',
        details: {
          currentPlanId,
          newPlanId,
        },
      });
    }

    console.log('Plan change request validated:', {
      currentPlanId,
      newPlanId,
      subscriptionId,
    });

    // 6. Plan Change Flowを呼び出す
    const planChangeFlowFunctionName = process.env.PLAN_CHANGE_FLOW_FUNCTION_NAME;

    if (!planChangeFlowFunctionName) {
      console.error('PLAN_CHANGE_FLOW_FUNCTION_NAME is not configured');
      return internalServerError500Response({
        message: 'サーバー設定エラーが発生しました',
        code: 'CONFIGURATION_ERROR',
      });
    }

    const flowInput: PlanChangeFlowInput = {
      tenantId,
      userId,
      currentPlanId,
      newPlanId,
      subscriptionId,
    };

    console.log('Invoking plan change flow:', {
      functionName: planChangeFlowFunctionName,
      input: flowInput,
    });

    const invokeCommand = new InvokeCommand({
      FunctionName: planChangeFlowFunctionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(flowInput),
    });

    const invokeResult = await lambdaClient.send(invokeCommand);

    // 7. Lambda呼び出し結果の処理
    if (invokeResult.FunctionError) {
      console.error('Plan change flow function error:', {
        functionError: invokeResult.FunctionError,
        payload: invokeResult.Payload
          ? new TextDecoder().decode(invokeResult.Payload)
          : null,
      });

      return internalServerError500Response({
        message: 'プラン変更処理中にエラーが発生しました',
        code: 'PLAN_CHANGE_FLOW_ERROR',
        details: {
          functionError: invokeResult.FunctionError,
        },
      });
    }

    if (!invokeResult.Payload) {
      console.error('Plan change flow returned no payload');
      return internalServerError500Response({
        message: 'プラン変更処理からのレスポンスが不正です',
        code: 'INVALID_FLOW_RESPONSE',
      });
    }

    const flowOutput: PlanChangeFlowOutput = JSON.parse(
      new TextDecoder().decode(invokeResult.Payload)
    );

    console.log('Plan change flow completed:', {
      success: flowOutput.success,
      flowExecutionId: flowOutput.flowExecutionId,
    });

    // 8. フロー実行結果の確認
    if (!flowOutput.success) {
      console.error('Plan change flow failed:', {
        flowExecutionId: flowOutput.flowExecutionId,
        errorDetails: flowOutput.errorDetails,
      });

      return internalServerError500Response({
        message:
          flowOutput.errorDetails?.errorMessage || 'プラン変更処理に失敗しました',
        code: flowOutput.errorDetails?.errorCode || 'PLAN_CHANGE_FAILED',
        details: {
          flowExecutionId: flowOutput.flowExecutionId,
        },
      });
    }

    // 9. 成功レスポンスを返す
    const message =
      flowOutput.changeType === 'upgrade'
        ? 'プランがアップグレードされました。新しいプランは即座に有効になります。'
        : 'プランのダウングレードが予約されました。現在の請求期間終了時に新しいプランに切り替わります。';

    const response: ChangeSubscriptionPlanResponse = {
      success: true,
      flowExecutionId: flowOutput.flowExecutionId,
      changeType: flowOutput.changeType,
      newPlanId: flowOutput.newPlanId,
      effectiveDate: flowOutput.effectiveDate,
      message,
    };

    console.log('Plan change completed successfully:', {
      flowExecutionId: flowOutput.flowExecutionId,
      changeType: flowOutput.changeType,
      newPlanId: flowOutput.newPlanId,
      effectiveDate: flowOutput.effectiveDate,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in changeSubscriptionPlan:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};