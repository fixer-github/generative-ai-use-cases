/**
 * User-facing Change Subscription Plan API
 *
 * ユーザ向けのプラン変更API。
 * 現在のサブスクリプションから新しいプランへの変更を処理します。
 * アップグレードは即座に、ダウングレードは次回更新時に適用されます。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CORS_HEADERS } from '../../../utils/apiResponse';
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
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
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
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です',
          },
        } as ErrorResponse),
      };
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'リクエストボディが必要です',
          },
        } as ErrorResponse),
      };
    }

    let requestBody: ChangeSubscriptionPlanRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'リクエストボディが不正なJSON形式です',
          },
        } as ErrorResponse),
      };
    }

    const { newPlanId, subscriptionId } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!newPlanId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'newPlanId',
              reason: 'newPlanIdは必須です',
            },
          },
        } as ErrorResponse),
      };
    }

    if (!subscriptionId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'subscriptionId',
              reason: 'subscriptionIdは必須です',
            },
          },
        } as ErrorResponse),
      };
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
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'DATA_ACCESS_ERROR',
            message: 'プラン情報の取得に失敗しました',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        } as ErrorResponse),
      };
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
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'NO_ACTIVE_PLAN',
            message: '現在有効なプランがありません',
          },
        } as ErrorResponse),
      };
    }

    const currentPlanId = highestPriorityApplication.plan_id;

    // 5. 同じプランへの変更をチェック
    if (currentPlanId === newPlanId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'SAME_PLAN',
            message: '同じプランへの変更はできません',
            details: {
              currentPlanId,
              newPlanId,
            },
          },
        } as ErrorResponse),
      };
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
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'サーバー設定エラーが発生しました',
          },
        } as ErrorResponse),
      };
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

      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PLAN_CHANGE_FLOW_ERROR',
            message: 'プラン変更処理中にエラーが発生しました',
            details: {
              functionError: invokeResult.FunctionError,
            },
          },
        } as ErrorResponse),
      };
    }

    if (!invokeResult.Payload) {
      console.error('Plan change flow returned no payload');
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FLOW_RESPONSE',
            message: 'プラン変更処理からのレスポンスが不正です',
          },
        } as ErrorResponse),
      };
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

      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: flowOutput.errorDetails?.errorCode || 'PLAN_CHANGE_FAILED',
            message:
              flowOutput.errorDetails?.errorMessage || 'プラン変更処理に失敗しました',
            details: {
              flowExecutionId: flowOutput.flowExecutionId,
            },
          },
        } as ErrorResponse),
      };
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

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Unexpected error in changeSubscriptionPlan:', error);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } as ErrorResponse),
    };
  }
};