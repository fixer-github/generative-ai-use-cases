/**
 * サブスクリプション統計取得API
 * GET /admin/billing/subscriptions/statistics
 *
 * サブスクリプション全体の統計情報を取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { SubscriptionRepository } from '../../../repositories';
import { getRdsConfig } from '../../../utils/rdsConfig';

interface QueryParams {
  period?: 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_1_year';
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
    const period = params.period || 'last_30_days';

    // パラメータのバリデーション
    const validPeriods = ['last_7_days', 'last_30_days', 'last_90_days', 'last_1_year'];
    if (!validPeriods.includes(period)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'period',
              reason: `periodには '${validPeriods.join("', '")}' のいずれかを指定してください`,
            },
          },
        }),
      };
    }

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const subscriptionRepository = new SubscriptionRepository(rdsConfig);

    // 統計情報を取得
    const statistics = await subscriptionRepository.getStatistics();

    // 今月の新規契約数とキャンセル数を計算
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // TODO: 実際の実装では、これらの値をデータベースから取得する必要があります
    // 現時点では簡易実装として0を返します
    const newSubscriptionsThisMonth = 0;
    const canceledSubscriptionsThisMonth = 0;
    const newSubscriptionsLastMonth = 0;
    const canceledSubscriptionsLastMonth = 0;
    const activeLastMonth = statistics.byStatus.active || 0;

    // 前月との比較を計算
    const activeChange = (statistics.byStatus.active || 0) - activeLastMonth;
    const activeChangePercentage = activeLastMonth > 0
      ? ((activeChange / activeLastMonth) * 100)
      : 0;

    // レスポンスの構築
    const response = {
      summary: {
        active_subscriptions: statistics.byStatus.active || 0,
        pending_verification_subscriptions: statistics.byStatus.pending_verification || 0,
        past_due_subscriptions: statistics.byStatus.past_due || 0,
        new_subscriptions_this_month: newSubscriptionsThisMonth,
        canceled_subscriptions_this_month: canceledSubscriptionsThisMonth,
        comparison_with_last_month: {
          active_subscriptions_change: activeChange,
          active_subscriptions_change_percentage: Math.round(activeChangePercentage * 10) / 10,
          pending_verification_change: (statistics.byStatus.pending_verification || 0) - 0,
          past_due_change: (statistics.byStatus.past_due || 0) - 0,
          new_subscriptions_change: newSubscriptionsThisMonth - newSubscriptionsLastMonth,
          canceled_subscriptions_change: canceledSubscriptionsThisMonth - canceledSubscriptionsLastMonth,
        },
      },
      breakdown_by_platform: {
        stripe: {
          active: statistics.byPlatform.stripe?.active || 0,
          pending_verification: statistics.byPlatform.stripe?.pending_verification || 0,
          past_due: statistics.byPlatform.stripe?.past_due || 0,
          canceled: statistics.byPlatform.stripe?.canceled || 0,
        },
        apple: {
          active: statistics.byPlatform.apple?.active || 0,
          pending_verification: statistics.byPlatform.apple?.pending_verification || 0,
          past_due: statistics.byPlatform.apple?.past_due || 0,
          canceled: statistics.byPlatform.apple?.canceled || 0,
        },
        google: {
          active: statistics.byPlatform.google?.active || 0,
          pending_verification: statistics.byPlatform.google?.pending_verification || 0,
          past_due: statistics.byPlatform.google?.past_due || 0,
          canceled: statistics.byPlatform.google?.canceled || 0,
        },
      },
      breakdown_by_plan: statistics.byPlan.map(plan => ({
        plan_id: plan.planId,
        plan_name: plan.planName,
        active: plan.count,
        pending_verification: 0, // TODO: プラン別のステータス内訳を取得
        past_due: 0,
        new_this_month: 0,
        canceled_this_month: 0,
      })),
      breakdown_by_status: {
        active: statistics.byStatus.active || 0,
        pending_verification: statistics.byStatus.pending_verification || 0,
        past_due: statistics.byStatus.past_due || 0,
        canceled: statistics.byStatus.canceled || 0,
        expired: statistics.byStatus.expired || 0,
      },
      trend: {
        period,
        data_points: [],  // TODO: トレンドデータの実装
      },
      updated_at: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting subscription statistics:', error);
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
