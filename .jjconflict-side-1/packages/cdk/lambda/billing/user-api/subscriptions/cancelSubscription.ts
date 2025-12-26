/**
 * User-facing Cancel Subscription API
 *
 * ユーザ向けのサブスクリプション解約API。
 * subscriptionIdとcancellationType（即時解約/期限終了時解約）を受け取り、
 * オーケストレーションのcancellationFlowを呼び出します。
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

    let requestBody: CancelSubscriptionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { subscriptionId, cancellationType, reason } = requestBody;

    // 3. 必須パラメータのバリデーション
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

    if (!cancellationType) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'cancellationType',
          reason: 'cancellationTypeは必須です',
        },
      });
    }

    // 4. cancellationTypeの値チェック
    if (!['immediate', 'at_period_end'].includes(cancellationType)) {
      return badRequest400Response({
        message: 'cancellationTypeの値が不正です',
        code: 'INVALID_PARAMETER',
        details: {
          field: 'cancellationType',
          reason:
            "cancellationTypeは 'immediate' または 'at_period_end' のいずれかである必要があります",
          received: cancellationType,
        },
      });
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
      return internalServerError500Response({
        message: 'サーバー設定エラーが発生しました',
        code: 'CONFIGURATION_ERROR',
      });
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

      return internalServerError500Response({
        message: '解約処理中にエラーが発生しました',
        code: 'CANCELLATION_FLOW_ERROR',
        details: {
          functionError: invokeResult.FunctionError,
        },
      });
    }

    if (!invokeResult.Payload) {
      console.error('Cancellation flow returned no payload');
      return internalServerError500Response({
        message: '解約処理からのレスポンスが不正です',
        code: 'INVALID_FLOW_RESPONSE',
      });
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

      return internalServerError500Response({
        message:
          flowOutput.errorDetails?.errorMessage || '解約処理に失敗しました',
        code: flowOutput.errorDetails?.errorCode || 'CANCELLATION_FAILED',
        details: {
          flowExecutionId: flowOutput.flowExecutionId,
        },
      });
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

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in cancelSubscription:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
