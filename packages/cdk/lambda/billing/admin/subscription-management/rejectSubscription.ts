/**
 * サブスクリプション却下API
 * POST /admin/billing/subscriptions/{subscription_id}/reject
 *
 * 検証保留中のサブスクリプションを却下します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import { SubscriptionRepository } from '../../../repositories';
import { getRdsConfig } from '../../../utils/rdsConfig';

interface RejectRequest {
  rejection_reason: 'invalid_receipt' | 'invalid_signature' | 'duplicate_receipt' | 'other';
  rejection_details?: string;
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
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUEST_BODY',
            message: 'リクエストボディが指定されていません',
          },
        }),
      };
    }

    const requestBody: RejectRequest = JSON.parse(event.body);

    // rejection_reasonの検証
    if (!requestBody.rejection_reason) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'rejection_reason',
              reason: 'rejection_reasonは必須です',
            },
          },
        }),
      };
    }

    const validReasons = ['invalid_receipt', 'invalid_signature', 'duplicate_receipt', 'other'];
    if (!validReasons.includes(requestBody.rejection_reason)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'rejection_reason',
              reason: `rejection_reasonには '${validReasons.join("', '")}' のいずれかを指定してください`,
            },
          },
        }),
      };
    }

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const subscriptionRepository = new SubscriptionRepository(rdsConfig);

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
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_STATUS_FOR_REJECTION',
            message: 'このステータスのサブスクリプションは却下できません',
            details: {
              subscription_id: subscriptionId,
              current_status: subscription.subscription_status,
              reason: '却下できるのは pending_verification ステータスのサブスクリプションのみです',
            },
          },
        }),
      };
    }

    const now = new Date();

    // サブスクリプションのステータスを更新
    const updatedSubscription = await subscriptionRepository.update(subscriptionId, {
      subscription_status: 'rejected',
    });

    if (!updatedSubscription) {
      throw new Error('Failed to update subscription status');
    }

    // TODO: 以下の処理を実装
    // 1. 却下理由と却下を実行した管理者の情報を記録（履歴テーブル）
    // 2. ユーザに通知を送信
    // 3. 操作を監査ログに記録

    // レスポンスの構築
    const response = {
      subscription_id: subscription.subscription_id,
      previous_status: 'pending_verification',
      new_status: 'rejected',
      rejected_at: now.toISOString(),
      rejected_by: adminResult.userId,
      rejection_reason: requestBody.rejection_reason,
      rejection_details: requestBody.rejection_details || null,
      notification_sent: false, // TODO: 通知実装後にtrueに変更
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error rejecting subscription:', error);
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
