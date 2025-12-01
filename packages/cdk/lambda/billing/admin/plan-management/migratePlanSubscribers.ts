/**
 * プラン加入者一括移行API
 * POST /admin/billing/plans/{plan_id}/migrate
 *
 * 指定されたプランの加入者を別のプランへ一括移行します。
 * 移行先プランはinternalプランで、新規加入を受け付けている状態のもののみ対象です。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { verifyAdminAccess, isAdminContext } from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  UserPlanApplication,
} from '../../data-access/repositories/types';
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

interface MigrateRequestBody {
  targetPlanId: string;
  userIds: string[];
}

interface MigrationResult {
  userId: string;
  success: boolean;
  applicationId?: string;
  previousApplicationIds?: string[];
  error?: {
    code: string;
    message: string;
  };
}

interface MigrationResponse {
  sourcePlanId: string;
  targetPlanId: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  results: MigrationResult[];
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

    // パスパラメータからplan_id（移行元プランID）を取得
    const sourcePlanId = event.pathParameters?.plan_id;
    if (!sourcePlanId) {
      return badRequest400Response({
        message: '移行元プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'plan_id',
          reason: 'パスパラメータにplan_idを指定してください',
        },
      });
    }

    // リクエストボディのパース
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが空です',
        code: 'EMPTY_BODY',
        details: {
          reason: 'targetPlanIdとuserIdsを含むJSONボディを指定してください',
        },
      });
    }

    let requestBody: MigrateRequestBody;
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

    const { targetPlanId, userIds } = requestBody;

    // 入力バリデーション
    if (!targetPlanId) {
      return badRequest400Response({
        message: '移行先プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'targetPlanId',
          reason: 'targetPlanIdを指定してください',
        },
      });
    }

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return badRequest400Response({
        message: '移行対象ユーザIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'userIds',
          reason: 'userIdsに1つ以上のユーザIDを指定してください',
        },
      });
    }

    // 移行元と移行先が同じでないことを確認
    if (sourcePlanId === targetPlanId) {
      return badRequest400Response({
        message: '移行元と移行先のプランが同じです',
        code: 'SAME_PLAN',
        details: {
          sourcePlanId,
          targetPlanId,
          reason: '異なるプランを指定してください',
        },
      });
    }

    // 移行元プランの存在確認
    const sourcePlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: sourcePlanId }
    );
    if (!sourcePlan) {
      return notFound404Response({
        message: '移行元プランが見つかりません',
        code: 'SOURCE_PLAN_NOT_FOUND',
        details: {
          plan_id: sourcePlanId,
        },
      });
    }

    // 移行元プランがinternalであることを確認（現時点ではinternalプランのみ対応）
    if (sourcePlan.platform_type !== 'internal') {
      return badRequest400Response({
        message: '現時点ではinternalプランからの移行のみ対応しています',
        code: 'UNSUPPORTED_PLATFORM_TYPE',
        details: {
          platform_type: sourcePlan.platform_type,
          reason:
            'Stripe、Apple、Googleプランからの移行は今後対応予定です',
        },
      });
    }

    // 移行先プランの存在確認
    const targetPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: targetPlanId }
    );
    if (!targetPlan) {
      return notFound404Response({
        message: '移行先プランが見つかりません',
        code: 'TARGET_PLAN_NOT_FOUND',
        details: {
          plan_id: targetPlanId,
        },
      });
    }

    // 移行先プランがinternalであることを確認
    if (targetPlan.platform_type !== 'internal') {
      return badRequest400Response({
        message: '移行先プランはinternalプランである必要があります',
        code: 'INVALID_TARGET_PLATFORM_TYPE',
        details: {
          platform_type: targetPlan.platform_type,
          reason: 'internalプランのみを移行先として指定できます',
        },
      });
    }

    // 移行先プランが新規加入を受け付けていることを確認
    if (targetPlan.status !== 'active') {
      return badRequest400Response({
        message: '移行先プランは新規加入を受け付けている状態である必要があります',
        code: 'TARGET_PLAN_NOT_ACTIVE',
        details: {
          status: targetPlan.status,
          reason: 'statusがactiveのプランのみを移行先として指定できます',
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

    // 各ユーザに対して移行を実行
    const results: MigrationResult[] = [];
    const now = new Date().toISOString();

    for (const userId of userIds) {
      try {
        // ユーザがこのプランに加入しているか確認
        const userApplications = await invokeDataAccessFunction<
          UserPlanApplication[]
        >(event, 'user-plan-application', 'findAll', {
          userId,
          planId: sourcePlanId,
          status: ['active', 'scheduled_termination'],
        });

        if (userApplications.length === 0) {
          results.push({
            userId,
            success: false,
            error: {
              code: 'USER_NOT_SUBSCRIBED',
              message:
                'このユーザは移行元プランに加入していません',
            },
          });
          continue;
        }

        // applyPlanToUser Lambda関数を呼び出し
        const applyInput: ApplyPlanToUserInput = {
          userId,
          planId: targetPlanId,
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

          console.error('applyPlanToUser failed for user:', {
            userId,
            functionError: invokeResponse.FunctionError,
            errorPayload,
          });

          results.push({
            userId,
            success: false,
            error: {
              code: errorPayload.code || 'APPLY_PLAN_ERROR',
              message:
                errorPayload.message ||
                'プラン適用中にエラーが発生しました',
            },
          });
          continue;
        }

        const applyOutput = JSON.parse(
          new TextDecoder().decode(invokeResponse.Payload)
        ) as ApplyPlanToUserOutput;

        results.push({
          userId,
          success: true,
          applicationId: applyOutput.applicationId,
          previousApplicationIds: applyOutput.previousApplicationIds,
        });

        console.log('Successfully migrated user:', {
          userId,
          applicationId: applyOutput.applicationId,
          previousApplicationIds: applyOutput.previousApplicationIds,
        });
      } catch (error) {
        console.error('Error migrating user:', { userId, error });

        let errorCode = 'MIGRATION_ERROR';
        let errorMessage = '移行処理中にエラーが発生しました';

        if (error instanceof ApplyPlanToUserError) {
          errorCode = error.code;
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        results.push({
          userId,
          success: false,
          error: {
            code: errorCode,
            message: errorMessage,
          },
        });
      }
    }

    // 結果の集計
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    const response: MigrationResponse = {
      sourcePlanId,
      targetPlanId,
      totalCount: userIds.length,
      successCount,
      failureCount,
      results,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error migrating plan subscribers:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
