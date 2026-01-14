/**
 * 個別ユーザーへのプラン適用API
 * POST /admin/billing/users/{user_id}/apply-plan
 *
 * 指定されたユーザーを特定のプランに適用します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { verifyAdminAccess, isAdminContext } from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import {
  ApplyPlanToUserInput,
  ApplyPlanToUserOutput,
  ApplyPlanToUserError,
} from '../../plan-management/applyPlanToUser';

const lambdaClient = new LambdaClient({});

interface ApplyPlanRequestBody {
  planId: string;
}

interface ApplyPlanResponse {
  userId: string;
  planId: string;
  applicationId: string;
  previousApplicationIds: string[];
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // 管理者権限の検証
    const adminResult = await verifyAdminAccess(event);
    if (!isAdminContext(adminResult)) {
      return adminResult;
    }

    // パスパラメータからuser_idを取得
    const userId = event.pathParameters?.user_id;
    if (!userId) {
      return badRequest400Response({
        message: 'ユーザーIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'user_id',
          reason: 'パスパラメータにuser_idを指定してください',
        },
      });
    }

    // リクエストボディのパース
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが空です',
        code: 'EMPTY_BODY',
        details: {
          reason: 'planIdを含むJSONボディを指定してください',
        },
      });
    }

    let requestBody: ApplyPlanRequestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディの形式が不正です',
        code: 'INVALID_JSON',
        details: {
          reason: '有効なJSON形式でリクエストしてください',
        },
      });
    }

    const { planId } = requestBody;

    // 入力バリデーション
    if (!planId) {
      return badRequest400Response({
        message: 'プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'planId',
          reason: 'planIdを指定してください',
        },
      });
    }

    // プランの存在確認
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );
    if (!plan) {
      return notFound404Response({
        message: 'プランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: {
          plan_id: planId,
        },
      });
    }

    // プランがinternalであることを確認
    if (plan.platform_type !== 'internal') {
      return badRequest400Response({
        message: '現時点ではinternalプランのみ対応しています',
        code: 'UNSUPPORTED_PLATFORM_TYPE',
        details: {
          platform_type: plan.platform_type,
          reason:
            'Stripe、Apple、Googleプランへの手動適用は今後対応予定です',
        },
      });
    }

    // プランが新規加入を受け付けていることを確認
    if (plan.status !== 'active') {
      return badRequest400Response({
        message: 'プランは新規加入を受け付けている状態である必要があります',
        code: 'PLAN_NOT_ACTIVE',
        details: {
          status: plan.status,
          reason: 'statusがactiveのプランのみを適用できます',
        },
      });
    }

    // テナントIDの取得（adminResultから）
    const tenantId = adminResult.tenantId;

    // applyPlanToUser関数名
    const applyPlanFunctionName =
      process.env.APPLY_PLAN_TO_USER_FUNCTION_NAME;
    if (!applyPlanFunctionName) {
      console.error('APPLY_PLAN_TO_USER_FUNCTION_NAME is not configured');
      return internalServerError500Response({
        message: 'サーバー設定エラーが発生しました',
        code: 'CONFIGURATION_ERROR',
        details: {
          reason: 'APPLY_PLAN_TO_USER_FUNCTION_NAMEが設定されていません',
        },
      });
    }

    const now = new Date().toISOString();

    // applyPlanToUser Lambda関数を呼び出し
    const applyInput: ApplyPlanToUserInput = {
      userId,
      planId,
      applicationSource: 'manual',
      validFrom: now,
      tenantId,
    };

    const invokeResponse = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: applyPlanFunctionName,
        Payload: JSON.stringify(applyInput),
      })
    );

    // レスポンスの解析
    if (invokeResponse.FunctionError) {
      const errorPayload = invokeResponse.Payload
        ? JSON.parse(new TextDecoder().decode(invokeResponse.Payload))
        : {};

      console.error('applyPlanToUser failed:', {
        userId,
        functionError: invokeResponse.FunctionError,
        errorPayload,
      });

      return internalServerError500Response({
        message: 'プラン適用中にエラーが発生しました',
        code: errorPayload.code || 'APPLY_PLAN_ERROR',
        details: {
          userId,
          error: errorPayload.message || 'Unknown error',
        },
      });
    }

    const applyOutput = JSON.parse(
      new TextDecoder().decode(invokeResponse.Payload)
    ) as ApplyPlanToUserOutput;

    console.log('Successfully applied plan to user:', {
      userId,
      planId,
      applicationId: applyOutput.applicationId,
      previousApplicationIds: applyOutput.previousApplicationIds,
    });

    const response: ApplyPlanResponse = {
      userId,
      planId,
      applicationId: applyOutput.applicationId,
      previousApplicationIds: applyOutput.previousApplicationIds,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error applying plan to user:', error);

    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = 'サーバー内部エラーが発生しました';

    if (error instanceof ApplyPlanToUserError) {
      errorCode = error.code;
      errorMessage = error.message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return internalServerError500Response({
      message: errorMessage,
      code: errorCode,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
