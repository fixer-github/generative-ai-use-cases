/**
 * プランステータス変更API
 * PATCH /admin/billing/plans/{plan_id}/status
 *
 * 既存のプランのステータスを変更します。ステータス遷移ルールに従って変更が行われます。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../../utils/adminAuth';
import {
  PlanRepository,
  UserPlanApplicationRepository,
} from '../../../repositories';
import { getRdsConnection } from '../../../utils/rdsConnection';

interface UpdateStatusRequest {
  new_status: 'active' | 'closed_to_new' | 'deprecated';
}

// ステータス遷移ルール
const STATUS_TRANSITIONS: Record<string, string[]> = {
  active: ['closed_to_new'],
  closed_to_new: ['deprecated'],
  deprecated: [],
};

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

    // リクエストボディのパース
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUEST_BODY',
            message: 'リクエストボディが必要です',
          },
        }),
      };
    }

    let requestBody: UpdateStatusRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'リクエストボディのJSON形式が不正です',
          },
        }),
      };
    }

    // 必須フィールドのバリデーション
    if (!requestBody.new_status) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'new_status',
              reason: 'new_statusは必須です',
            },
          },
        }),
      };
    }

    // ステータス値のバリデーション
    if (
      !['active', 'closed_to_new', 'deprecated'].includes(
        requestBody.new_status
      )
    ) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FIELD_VALUE',
            message: 'フィールドの値が不正です',
            details: {
              field: 'new_status',
              reason:
                "new_statusには 'active', 'closed_to_new', 'deprecated' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // RDS接続設定の取得
    const rdsConnection = await getRdsConnection(event);
    const planRepository = new PlanRepository(rdsConnection);
    const userPlanApplicationRepository = new UserPlanApplicationRepository(
      rdsConnection
    );

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

    // 現在のステータスと同じ場合は何もしない
    if (plan.status === requestBody.new_status) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          plan_id: plan.plan_id,
          internal_name: plan.internal_name,
          display_name: plan.display_name,
          status: plan.status,
          previous_status: plan.status,
          updated_at: plan.updated_at.toISOString(),
          updated_by: adminResult.username,
        }),
      };
    }

    // ステータス遷移ルールのチェック
    const allowedStatuses = STATUS_TRANSITIONS[plan.status] || [];
    if (!allowedStatuses.includes(requestBody.new_status)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: 'このステータス遷移は許可されていません',
            details: {
              current_status: plan.status,
              requested_status: requestBody.new_status,
              allowed_statuses: allowedStatuses,
              reason: `${plan.status} から ${requestBody.new_status} への遷移はできません`,
            },
          },
        }),
      };
    }

    // deprecatedへの遷移の場合、契約者数をチェック
    if (requestBody.new_status === 'deprecated') {
      // プランIDに紐づく有効なユーザプラン適用を取得
      const allApplications = await userPlanApplicationRepository.findAll({
        planId,
        status: ['active', 'scheduled_termination'],
      });

      if (allApplications.length > 0) {
        return {
          statusCode: 409,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'CANNOT_DEPRECATE_WITH_ACTIVE_SUBSCRIPTIONS',
              message: `このプランには現在${allApplications.length}人の契約者がいるため、廃止できません`,
              details: {
                active_subscription_count: allApplications.length,
                reason: 'すべての契約が終了してから廃止してください',
              },
            },
          }),
        };
      }
    }

    // ステータスを更新
    const previousStatus = plan.status;
    const updatedPlan = await planRepository.update(planId, {
      status: requestBody.new_status,
    });

    if (!updatedPlan) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UPDATE_FAILED',
            message: 'プランのステータス更新に失敗しました',
          },
        }),
      };
    }

    // TODO: 監査ログの記録
    // TODO: プラン変更履歴テーブルへの記録
    console.log(
      `Plan status updated: ${updatedPlan.plan_id} from ${previousStatus} to ${updatedPlan.status} by user ${adminResult.username}`
    );

    // レスポンスの構築
    const response = {
      plan_id: updatedPlan.plan_id,
      internal_name: updatedPlan.internal_name,
      display_name: updatedPlan.display_name,
      status: updatedPlan.status,
      previous_status: previousStatus,
      updated_at: updatedPlan.updated_at.toISOString(),
      updated_by: adminResult.username,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error updating plan status:', error);
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
