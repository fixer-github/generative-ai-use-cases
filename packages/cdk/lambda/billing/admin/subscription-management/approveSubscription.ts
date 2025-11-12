/**
 * サブスクリプション承認API
 * POST /admin/billing/subscriptions/{subscription_id}/approve
 *
 * 検証保留中のサブスクリプションを承認し、ユーザのプランを有効化します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import {
  SubscriptionRepository,
  UserPlanApplicationRepository,
} from '../../../repositories';
import { getRdsConnection } from '../../../utils/rdsConnection';

interface ApproveRequest {
  note?: string;
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

    // リクエストボディのパース
    const requestBody: ApproveRequest = event.body
      ? JSON.parse(event.body)
      : {};

    // RDS接続設定の取得
    const rdsConnection = await getRdsConnection(event);
    const subscriptionRepository = new SubscriptionRepository(rdsConnection);
    const userPlanApplicationRepository = new UserPlanApplicationRepository(
      rdsConnection
    );

    // サブスクリプション情報を取得
    const subscription = await subscriptionRepository.findById(subscriptionId);
    if (!subscription) {
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

    // ステータスの確認
    if (subscription.subscription_status !== 'pending_verification') {
      // 既に承認済みの場合
      if (subscription.subscription_status === 'active') {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'ALREADY_APPROVED',
              message: 'このサブスクリプションは既に承認されています',
              details: {
                subscription_id: subscriptionId,
                current_status: subscription.subscription_status,
              },
            },
          }),
        };
      }

      // その他のステータスの場合
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_STATUS_FOR_APPROVAL',
            message: 'このステータスのサブスクリプションは承認できません',
            details: {
              subscription_id: subscriptionId,
              current_status: subscription.subscription_status,
              reason:
                '承認できるのは pending_verification ステータスのサブスクリプションのみです',
            },
          },
        }),
      };
    }

    const now = new Date();

    // 1. サブスクリプションのステータスを更新
    const updatedSubscription = await subscriptionRepository.update(
      subscriptionId,
      {
        subscription_status: 'active',
      }
    );

    if (!updatedSubscription) {
      throw new Error('Failed to update subscription status');
    }

    // 2. ユーザプラン適用レコードを作成
    const userPlanApplication = await userPlanApplicationRepository.create({
      user_id: subscription.user_id,
      plan_id: subscription.plan_id,
      application_source: 'subscription',
      application_source_id: subscription.subscription_id,
      application_status: 'active',
      valid_from: subscription.current_period_start,
      valid_until: subscription.current_period_end,
    });

    // TODO: 以下の処理を実装
    // 3. OpenFGAに権限を登録
    // 4. 利用回数カウンターを初期化
    // 5. ユーザに通知を送信
    // 6. 操作を監査ログに記録

    // TODO: ステータス変更履歴を記録

    // レスポンスの構築
    const response = {
      subscription_id: subscription.subscription_id,
      previous_status: 'pending_verification',
      new_status: 'active',
      approved_at: now.toISOString(),
      approved_by: adminResult.username,
      user_plan_application_id: userPlanApplication.application_id,
      notification_sent: false, // TODO: 通知実装後にtrueに変更
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error approving subscription:', error);
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
