/**
 * プラン変更履歴取得API
 * GET /admin/billing/plans/{plan_id}/history
 *
 * 指定されたプランに対して行われた変更の履歴を取得します。
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

    // クエリパラメータの取得
    const page = Math.max(
      1,
      parseInt(event.queryStringParameters?.page || '1', 10)
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(event.queryStringParameters?.limit || '20', 10))
    );

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const planRepository = new PlanRepository(rdsConfig);

    // プランの存在確認
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

    // TODO: プラン変更履歴テーブルから履歴を取得
    // 現在は仮のデータを返す
    const history = [
      {
        change_id: `hist_${Date.now()}`,
        changed_at: plan.created_at.toISOString(),
        changed_by: 'system',
        change_type: 'PLAN_CREATED',
        change_summary: 'プランを作成',
        details: null,
      },
    ];

    // ページネーション処理
    const totalCount = history.length;
    const totalPages = Math.ceil(totalCount / limit);
    const offset = (page - 1) * limit;
    const paginatedHistory = history.slice(offset, offset + limit);

    // レスポンスの構築
    const response = {
      plan_id: planId,
      history: paginatedHistory,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: totalCount,
        limit,
        has_next: page < totalPages,
        has_previous: page > 1,
      },
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting plan history:', error);
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
