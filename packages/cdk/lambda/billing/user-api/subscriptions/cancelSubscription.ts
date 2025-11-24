/**
 * User-facing Cancel Subscription API
 *
 * ユーザ向けのサブスクリプション解約API。
 * subscriptionIdとcancellationType（即時解約/期限終了時解約）を受け取り、
 * オーケストレーションのcancellationFlowを呼び出します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CORS_HEADERS } from '../../../utils/apiResponse';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import {
  CancellationFlowInput,
  CancellationFlowOutput,
  CancellationType,
} from '../../orchestration/types/flowTypes';

/**
 * リクエストボディの型
 */
interface CancelSubscriptionRequest {
  /** サブスクリプションID */
  subscriptionId: string;
  /** 解約タイプ: 'immediate'（即時解約）または 'at_period_end'（期限終了時解約） */
  cancellationType: CancellationType;
  /** 解約理由（オプション） */
  reason?: string;
}

/**
 * レスポンスボディの型
 */
interface CancelSubscriptionResponse {
  /** 成功フラグ */
  success: boolean;
  /** フロー実行ID */
  flowExecutionId: string;
  /** 解約タイプ */
  cancellationType: CancellationType;
  /** 解約が有効になる日時（ISO 8601形式） */
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
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Cancel Subscription request received');

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

    let requestBody: CancelSubscriptionRequest;
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

    const { subscriptionId, cancellationType, reason } = requestBody;

    // 3. 必須パラメータのバリデーション
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

    if (!cancellationType) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'cancellationType',
              reason: 'cancellationTypeは必須です',
            },
          },
        } as ErrorResponse),
      };
    }

    // 4. cancellationTypeの値チェック
    if (!['immediate', 'at_period_end'].includes(cancellationType)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: 'cancellationTypeの値が不正です',
            details: {
              field: 'cancellationType',
              reason:
                "cancellationTypeは 'immediate' または 'at_period_end' のいずれかである必要があります",
              received: cancellationType,
            },
          },
        } as ErrorResponse),
      };
    }

    console.log('Cancellation request validated:', {
      subscriptionId,
      cancellationType,
      hasReason: !!reason,
    });

    // 5. Cancellation Flowを呼び出す
    const cancellationFlowFunctionName =
      process.env.CANCELLATION_FLOW_FUNCTION_NAME;

    if (!cancellationFlowFunctionName) {
      console.error('CANCELLATION_FLOW_FUNCTION_NAME is not configured');
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

    const flowInput: CancellationFlowInput = {
      tenantId,
      userId,
      subscriptionId,
      cancellationType,
      reason,
    };

    console.log('Invoking cancellation flow:', {
      functionName: cancellationFlowFunctionName,
      input: flowInput,
    });

    const invokeCommand = new InvokeCommand({
      FunctionName: cancellationFlowFunctionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(flowInput),
    });

    const invokeResult = await lambdaClient.send(invokeCommand);

    // 6. Lambda呼び出し結果の処理
    if (invokeResult.FunctionError) {
      console.error('Cancellation flow function error:', {
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
            code: 'CANCELLATION_FLOW_ERROR',
            message: '解約処理中にエラーが発生しました',
            details: {
              functionError: invokeResult.FunctionError,
            },
          },
        } as ErrorResponse),
      };
    }

    if (!invokeResult.Payload) {
      console.error('Cancellation flow returned no payload');
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FLOW_RESPONSE',
            message: '解約処理からのレスポンスが不正です',
          },
        } as ErrorResponse),
      };
    }

    const flowOutput: CancellationFlowOutput = JSON.parse(
      new TextDecoder().decode(invokeResult.Payload)
    );

    console.log('Cancellation flow completed:', {
      success: flowOutput.success,
      flowExecutionId: flowOutput.flowExecutionId,
    });

    // 7. フロー実行結果の確認
    if (!flowOutput.success) {
      console.error('Cancellation flow failed:', {
        flowExecutionId: flowOutput.flowExecutionId,
        errorDetails: flowOutput.errorDetails,
      });

      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: flowOutput.errorDetails?.errorCode || 'CANCELLATION_FAILED',
            message:
              flowOutput.errorDetails?.errorMessage || '解約処理に失敗しました',
            details: {
              flowExecutionId: flowOutput.flowExecutionId,
            },
          },
        } as ErrorResponse),
      };
    }

    // 8. 成功レスポンスを返す
    const message =
      cancellationType === 'immediate'
        ? 'サブスクリプションが解約されました。'
        : 'サブスクリプションの解約が予約されました。現在の請求期間終了時に解約されます。';

    const response: CancelSubscriptionResponse = {
      success: true,
      flowExecutionId: flowOutput.flowExecutionId,
      cancellationType: flowOutput.cancellationType,
      effectiveDate: flowOutput.effectiveDate,
      message,
    };

    console.log('Cancel subscription completed successfully:', {
      flowExecutionId: flowOutput.flowExecutionId,
      cancellationType: flowOutput.cancellationType,
      effectiveDate: flowOutput.effectiveDate,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Unexpected error in cancelSubscription:', error);

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
