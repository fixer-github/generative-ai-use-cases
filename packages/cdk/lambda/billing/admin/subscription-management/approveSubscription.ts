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
} from '../../../utils/adminAuth';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';

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
      return badRequest400Response({
        message: 'サブスクリプションIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'subscription_id',
        },
      });
    }

    // リクエストボディのパース
    const requestBody: ApproveRequest = event.body
      ? JSON.parse(event.body)
      : {};

    // サブスクリプション情報を取得（データアクセス層Lambda関数を呼び出し）
    const subscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'findById',
      { subscriptionId }
    );
    if (!subscription) {
      return notFound404Response({
        message: '指定されたサブスクリプションが見つかりません',
        code: 'SUBSCRIPTION_NOT_FOUND',
        details: {
          subscription_id: subscriptionId,
        },
      });
    }

    // ステータスの確認
    if (subscription.subscription_status !== 'pending_verification') {
      // 既に承認済みの場合
      if (subscription.subscription_status === 'active') {
        return badRequest400Response({
          message: 'このサブスクリプションは既に承認されています',
          code: 'ALREADY_APPROVED',
          details: {
            subscription_id: subscriptionId,
            current_status: subscription.subscription_status,
          },
        });
      }

      // その他のステータスの場合
      return badRequest400Response({
        message: 'このステータスのサブスクリプションは承認できません',
        code: 'INVALID_STATUS_FOR_APPROVAL',
        details: {
          subscription_id: subscriptionId,
          current_status: subscription.subscription_status,
          reason:
            '承認できるのは pending_verification ステータスのサブスクリプションのみです',
        },
      });
    }

    const now = new Date();

    // 1. サブスクリプションのステータスを更新（データアクセス層Lambda関数を呼び出し）
    const updatedSubscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'update',
      {
        subscriptionId,
        updates: {
          subscription_status: 'active',
        },
      }
    );

    if (!updatedSubscription) {
      throw new Error('Failed to update subscription status');
    }

    // 2. ユーザプラン適用レコードを作成（データアクセス層Lambda関数を呼び出し）
    const userPlanApplication = await invokeDataAccessFunction<UserPlanApplication>(
      event,
      'user-plan-application',
      'create',
      {
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        application_source: 'subscription',
        application_source_id: subscription.subscription_id,
        application_status: 'active',
        valid_from: new Date(subscription.current_period_start).toISOString(),
        valid_until: new Date(subscription.current_period_end).toISOString(),
      }
    );

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

    return ok200Response(response);
  } catch (error) {
    console.error('Error approving subscription:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
