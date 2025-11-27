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
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Subscription } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

interface RejectRequest {
  rejection_reason:
    | 'invalid_receipt'
    | 'invalid_signature'
    | 'duplicate_receipt'
    | 'other';
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
      return badRequest400Response({
        message: 'サブスクリプションIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'subscription_id',
        },
      });
    }

    // リクエストボディのパース
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが指定されていません',
        code: 'MISSING_REQUEST_BODY',
        details: {},
      });
    }

    const requestBody: RejectRequest = JSON.parse(event.body);

    // rejection_reasonの検証
    if (!requestBody.rejection_reason) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'rejection_reason',
          reason: 'rejection_reasonは必須です',
        },
      });
    }

    const validReasons = [
      'invalid_receipt',
      'invalid_signature',
      'duplicate_receipt',
      'other',
    ];
    if (!validReasons.includes(requestBody.rejection_reason)) {
      return badRequest400Response({
        message: '無効なパラメータが指定されました',
        code: 'INVALID_PARAMETER',
        details: {
          field: 'rejection_reason',
          reason: `rejection_reasonには '${validReasons.join("', '")}' のいずれかを指定してください`,
        },
      });
    }

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
      return badRequest400Response({
        message: 'このステータスのサブスクリプションは却下できません',
        code: 'INVALID_STATUS_FOR_REJECTION',
        details: {
          subscription_id: subscriptionId,
          current_status: subscription.subscription_status,
          reason:
            '却下できるのは pending_verification ステータスのサブスクリプションのみです',
        },
      });
    }

    const now = new Date();

    // サブスクリプションのステータスを更新（データアクセス層Lambda関数を呼び出し）
    const updatedSubscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'update',
      {
        subscriptionId,
        updates: {
          subscription_status: 'rejected',
        },
      }
    );

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
      rejected_by: adminResult.username,
      rejection_reason: requestBody.rejection_reason,
      rejection_details: requestBody.rejection_details || null,
      notification_sent: false, // TODO: 通知実装後にtrueに変更
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error rejecting subscription:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
