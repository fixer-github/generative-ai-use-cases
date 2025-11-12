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
  CORS_HEADERS,
} from '../../utils/adminAuth';
import { PlanRepository } from '../../repositories';
import { getRdsConfig } from '../../utils/rdsConfig';

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
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: 'プランIDが指定されていません',
            details: {
              field: 'plan_id',
              reason: 'パスパラメータにplan_idを指定してください',
            },
          },
        }),
      };
    }

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const planRepository = new PlanRepository(rdsConfig);

    // プランを取得
    const plan = await planRepository.findById(planId);

    if (!plan) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PLAN_NOT_FOUND',
            message: '指定されたプランが見つかりません',
            details: {
              plan_id: planId,
            },
          },
        }),
      };
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
      created_at: plan.created_at.toISOString(),
      updated_at: plan.updated_at.toISOString(),
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting plan details:', error);
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
