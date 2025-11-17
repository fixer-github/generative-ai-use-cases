/**
 * 内部名称重複チェックAPI
 * GET /admin/billing/plans/check-name
 *
 * 指定された内部名称が既に使用されているかをチェックします。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';

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

    // クエリパラメータからinternal_nameを取得
    const internalName = event.queryStringParameters?.internal_name;
    if (!internalName) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_PARAMETER',
            message: '必須パラメータが不足しています',
            details: {
              parameter: 'internal_name',
              reason: 'internal_name パラメータは必須です',
            },
          },
        }),
      };
    }

    // データアクセス層Lambda関数を呼び出して内部名称の重複チェック
    const existingPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findByInternalName',
      { internalName }
    );

    if (existingPlan) {
      // 既に使用されている場合
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          internal_name: internalName,
          available: false,
          conflicting_plan: {
            plan_id: existingPlan.plan_id,
            display_name: existingPlan.display_name,
            status: existingPlan.status,
          },
        }),
      };
    } else {
      // 使用可能な場合
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          internal_name: internalName,
          available: true,
        }),
      };
    }
  } catch (error) {
    console.error('Error checking plan name:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      }),
    };
  }
};
