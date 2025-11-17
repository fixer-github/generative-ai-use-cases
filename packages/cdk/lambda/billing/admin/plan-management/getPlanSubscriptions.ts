/**
 * プラン契約状況取得API
 * GET /admin/billing/plans/{plan_id}/subscriptions
 *
 * 指定されたプランの現在の契約状況を取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  UserPlanApplication,
  Subscription,
} from '../../data-access/repositories/types';

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

    // プランの存在確認（データアクセス層Lambda関数を呼び出し）
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );
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

    // ユーザプラン適用を取得（active と scheduled_termination）（データアクセス層Lambda関数を呼び出し）
    const applications = await invokeDataAccessFunction<UserPlanApplication[]>(
      event,
      'user-plan-application',
      'findAll',
      {
        planId,
        status: ['active', 'scheduled_termination'],
      }
    );

    // 契約種別ごとの内訳を計算
    const breakdownBySource = {
      subscription: 0,
      trial: 0,
      manual: 0,
      default: 0,
      campaign: 0,
    };

    for (const app of applications) {
      breakdownBySource[app.application_source]++;
    }

    // プラットフォーム別の内訳を計算（サブスクリプション経由のみ）
    const subscriptionApplications = applications.filter(
      (app) => app.application_source === 'subscription'
    );

    const breakdownByPlatform: Record<string, number> = {
      stripe: 0,
      apple: 0,
      google: 0,
      internal: 0,
    };

    // サブスクリプション情報から プラットフォーム別の内訳を取得（データアクセス層Lambda関数を呼び出し）
    for (const app of subscriptionApplications) {
      if (app.application_source_id) {
        const subscription = await invokeDataAccessFunction<Subscription | null>(
          event,
          'subscription',
          'findById',
          { subscriptionId: app.application_source_id }
        );
        if (subscription) {
          breakdownByPlatform[subscription.platform_type]++;
        }
      }
    }

    // TODO: 過去30日間の契約者数推移データを取得
    // 現在は仮のデータを返す
    const today = new Date();
    const dataPoints = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dataPoints.push({
        date: date.toISOString().split('T')[0],
        subscriber_count: applications.length, // 仮の値
      });
    }

    // レスポンスの構築
    const response = {
      plan_id: planId,
      total_subscribers: applications.length,
      breakdown_by_source: breakdownBySource,
      breakdown_by_platform: breakdownByPlatform,
      trend: {
        period: 'last_30_days',
        data_points: dataPoints,
      },
      updated_at: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error getting plan subscriptions:', error);
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
