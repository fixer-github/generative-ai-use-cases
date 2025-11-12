/**
 * サブスクリプション詳細情報取得API
 * GET /admin/billing/subscriptions/{subscription_id}
 *
 * 指定されたサブスクリプションIDの詳細情報を取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { SubscriptionRepository } from '../../../repositories';
import { getRdsConfig } from '../../../utils/rdsConfig';

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

    // パスパラメータからサブスクリプションIDを取得
    const subscriptionId = event.pathParameters?.subscription_id;
    if (!subscriptionId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: 'サブスクリプションIDが指定されていません',
            details: {
              field: 'subscription_id',
            },
          },
        }),
      };
    }

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const subscriptionRepository = new SubscriptionRepository(rdsConfig);

    // サブスクリプション詳細情報を取得
    const result = await subscriptionRepository.findByIdWithDetails(subscriptionId);

    if (!result) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'SUBSCRIPTION_NOT_FOUND',
            message: '指定されたサブスクリプションが見つかりません',
            details: {
              subscription_id: subscriptionId,
            },
          },
        }),
      };
    }

    const { subscription, plan } = result;

    // TODO: ユーザ情報の取得
    // 現時点では簡易実装としてuser_idをそのまま使用
    const userInfo = {
      user_id: subscription.user_id,
      user_name: subscription.user_id, // TODO: ユーザ情報テーブルから取得
      email: `${subscription.user_id}@example.com`, // TODO: ユーザ情報テーブルから取得
      registered_at: subscription.created_at.toISOString(),
      total_subscriptions_count: 1, // TODO: ユーザの全サブスクリプション数を取得
    };

    // TODO: 更新回数の取得（履歴テーブルから）
    const renewalCount = 0;

    // レスポンスの構築
    const response = {
      subscription_id: subscription.subscription_id,
      platform_subscription_id: subscription.platform_subscription_id,
      status: subscription.subscription_status,
      created_at: subscription.created_at.toISOString(),
      updated_at: subscription.updated_at.toISOString(),
      user: userInfo,
      plan: {
        plan_id: plan.plan_id,
        internal_name: plan.internal_name,
        display_name: plan.display_name,
        platform_type: plan.platform_type,
        platform_product_id: plan.platform_product_id,
        status: plan.status,
        permissions: plan.permissions,
      },
      period: {
        current_period_start: subscription.current_period_start.toISOString(),
        current_period_end: subscription.current_period_end.toISOString(),
        next_billing_date: subscription.cancel_at_period_end
          ? null
          : subscription.current_period_end.toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        renewal_count: renewalCount,
        next_billing_amount: subscription.cancel_at_period_end
          ? null
          : {
              amount: 1980, // TODO: プラン情報から取得
              currency: 'JPY',
            },
      },
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting subscription details:', error);
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
