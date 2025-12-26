/**
 * プラン詳細取得API
 * GET /admin/billing/plans/{plan_id}
 *
 * 指定されたプランIDの詳細情報を取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

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

    // パスパラメータからplan_idを取得
    const planId = event.pathParameters?.plan_id;
    if (!planId) {
      return badRequest400Response({
        message: 'プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'plan_id',
          reason: 'パスパラメータにplan_idを指定してください',
        },
      });
    }

    // データアクセス層Lambda関数を呼び出してプランを取得
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );

    if (!plan) {
      return notFound404Response({
        message: '指定されたプランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: {
          plan_id: planId,
        },
      });
    }

    // レスポンスの構築
    const response = {
      plan_id: plan.plan_id,
      internal_name: plan.internal_name,
      display_name: plan.display_name,
      description: plan.description || null,
      platform_type: plan.platform_type,
      platform_product_id: plan.platform_product_id || null,
      permissions: plan.permissions,
      status: plan.status,
      is_default: plan.is_default,
      created_at: new Date(plan.created_at).toISOString(),
      updated_at: new Date(plan.updated_at).toISOString(),
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting plan details:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
