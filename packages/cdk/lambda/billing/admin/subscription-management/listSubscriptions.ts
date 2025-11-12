/**
 * サブスクリプション一覧取得API
 * GET /admin/billing/subscriptions
 *
 * サブスクリプション一覧を取得します。検索・絞り込み・ソート・ページネーション機能をサポートします。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { SubscriptionRepository } from '../../../repositories';
import { getRdsConnection } from '../../../utils/rdsConnection';

interface QueryParams {
  page?: string;
  limit?: string;
  sort_by?: 'created_at' | 'period_start' | 'period_end';
  sort_order?: 'asc' | 'desc';
  subscription_id?: string;
  user_id?: string;
  user_name?: string;
  platform_type?: 'stripe' | 'apple' | 'google';
  platform_subscription_id?: string;
  status?: 'active' | 'pending_verification' | 'past_due' | 'canceled' | 'expired';
  plan_id?: string;
  period_start_from?: string;
  period_start_to?: string;
  created_at_from?: string;
  created_at_to?: string;
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
    const params = (event.queryStringParameters || {}) as QueryParams;

    // パラメータの検証とデフォルト値の設定
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
    const sortBy = params.sort_by || 'created_at';
    const sortOrder = params.sort_order || 'desc';

    // sort_byのバリデーション
    const validSortBy = ['created_at', 'period_start', 'period_end'];
    if (!validSortBy.includes(sortBy)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'sort_by',
              reason: `sort_byには '${validSortBy.join("', '")}' のいずれかを指定してください`,
            },
          },
        }),
      };
    }

    // sort_orderのバリデーション
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
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

    // statusのバリデーション
    if (params.status) {
      const validStatuses = ['active', 'pending_verification', 'past_due', 'canceled', 'expired'];
      if (!validStatuses.includes(params.status)) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'INVALID_PARAMETER',
              message: '無効なパラメータが指定されました',
              details: {
                field: 'status',
                reason: `statusには '${validStatuses.join("', '")}' のいずれかを指定してください`,
              },
            },
          }),
        };
      }
    }

    // RDS接続設定の取得
    const rdsConnection = await getRdsConnection(event);
    const subscriptionRepository = new SubscriptionRepository(rdsConnection);

    // 日付パラメータのパース
    const periodStartFrom = params.period_start_from ? new Date(params.period_start_from) : undefined;
    const periodStartTo = params.period_start_to ? new Date(params.period_start_to) : undefined;
    const createdAtFrom = params.created_at_from ? new Date(params.created_at_from) : undefined;
    const createdAtTo = params.created_at_to ? new Date(params.created_at_to) : undefined;

    // サブスクリプション一覧を取得
    const result = await subscriptionRepository.findAllForAdmin({
      page,
      limit,
      sortBy: sortBy === 'period_start' ? 'current_period_start' : sortBy === 'period_end' ? 'current_period_end' : sortBy,
      sortOrder,
      subscriptionId: params.subscription_id,
      userId: params.user_id,
      userName: params.user_name,
      platformType: params.platform_type,
      platformSubscriptionId: params.platform_subscription_id,
      status: params.status,
      planId: params.plan_id,
      periodStartFrom,
      periodStartTo,
      createdAtFrom,
      createdAtTo,
    });

    const totalPages = Math.ceil(result.totalCount / limit);

    // レスポンスの構築
    const response = {
      subscriptions: result.subscriptions.map(sub => ({
        subscription_id: sub.subscription_id,
        user_id: sub.user_id,
        user_name: sub.user_id, // TODO: ユーザ情報テーブルから取得
        plan_id: sub.plan_id,
        plan_name: sub.plan_name || 'Unknown Plan',
        platform_type: sub.platform_type,
        platform_subscription_id: sub.platform_subscription_id,
        status: sub.subscription_status,
        period_start: sub.current_period_start.toISOString(),
        period_end: sub.current_period_end.toISOString(),
        created_at: sub.created_at.toISOString(),
      })),
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: result.totalCount,
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
    console.error('Error listing subscriptions:', error);
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
