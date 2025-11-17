/**
 * プラン一覧取得API
 * GET /admin/billing/plans
 *
 * プラン一覧を取得します。検索・絞り込み・ソート・ページネーション機能をサポートします。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';

interface ListPlansQueryParams {
  page?: string;
  limit?: string;
  sort_by?: 'created_at' | 'internal_name' | 'status';
  sort_order?: 'asc' | 'desc';
  platform_type?: 'stripe' | 'apple' | 'google' | 'internal';
  status?: 'active' | 'closed_to_new' | 'deprecated';
  search?: string;
}

interface PaginationInfo {
  current_page: number;
  total_pages: number;
  total_count: number;
  limit: number;
  has_next: boolean;
  has_previous: boolean;
}

interface Statistics {
  total_plans: number;
  active_plans: number;
  closed_to_new_plans: number;
  deprecated_plans: number;
}

interface ListPlansResponse {
  plans: Array<{
    plan_id: string;
    internal_name: string;
    display_name: string;
    platform_type: string;
    status: string;
    created_at: string;
  }>;
  pagination: PaginationInfo;
  statistics: Statistics;
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

    // クエリパラメータの取得
    const params = (event.queryStringParameters || {}) as ListPlansQueryParams;

    // パラメータの検証とデフォルト値の設定
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(params.limit || '20', 10))
    );
    const sortBy = params.sort_by || 'created_at';
    const sortOrder = params.sort_order || 'desc';
    const platformType = params.platform_type;
    const status = params.status;
    const search = params.search;

    // sort_byのバリデーション
    if (!['created_at', 'internal_name', 'status'].includes(sortBy)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'sort_by',
              reason:
                "sort_byには 'created_at', 'internal_name', 'status' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // sort_orderのバリデーション
    if (!['asc', 'desc'].includes(sortOrder)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'sort_order',
              reason: "sort_orderには 'asc' または 'desc' を指定してください",
            },
          },
        }),
      };
    }

    // データアクセス層Lambda関数を呼び出してプラン一覧を取得
    const allPlans = await invokeDataAccessFunction<Plan[]>(event, 'plan', 'findAll', {
      platformType,
      status,
      search,
      sortBy,
      sortOrder,
    });

    // 統計情報を計算（フィルタ前の全プランを対象）
    const allPlansForStats = await invokeDataAccessFunction<Plan[]>(
      event,
      'plan',
      'findAll',
      {}
    );
    const statistics: Statistics = {
      total_plans: allPlansForStats.length,
      active_plans: allPlansForStats.filter((p) => p.status === 'active')
        .length,
      closed_to_new_plans: allPlansForStats.filter(
        (p) => p.status === 'closed_to_new'
      ).length,
      deprecated_plans: allPlansForStats.filter(
        (p) => p.status === 'deprecated'
      ).length,
    };

    // ページネーション処理
    const totalCount = allPlans.length;
    const totalPages = Math.ceil(totalCount / limit);
    const offset = (page - 1) * limit;
    const paginatedPlans = allPlans.slice(offset, offset + limit);

    // レスポンスの構築
    const response: ListPlansResponse = {
      plans: paginatedPlans.map((plan) => ({
        plan_id: plan.plan_id,
        internal_name: plan.internal_name,
        display_name: plan.display_name,
        platform_type: plan.platform_type,
        status: plan.status,
        created_at: new Date(plan.created_at).toISOString(),
      })),
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: totalCount,
        limit,
        has_next: page < totalPages,
        has_previous: page > 1,
      },
      statistics,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error listing plans:', error);
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
