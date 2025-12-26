/**
 * デフォルトプラン設定API
 * PUT /admin/billing/plans/{plan_id}/default
 *
 * 指定されたプランをデフォルトプランに設定します。
 * 既存のデフォルトプランは自動的に解除されます。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

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
      return badRequest400Response({
        message: 'プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'plan_id',
          reason: 'パスパラメータにplan_idを指定してください',
        },
      });
    }

    // プランの存在確認とバリデーション
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );

    if (!plan) {
      return notFound404Response({
        message: '指定されたプランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: {
          plan_id: planId,
        },
      });
    }

    // internalプラットフォームタイプであることの確認
    if (plan.platform_type !== 'internal') {
      return badRequest400Response({
        message: 'デフォルトプランに設定できるのは、internal タイプのプランのみです',
        code: 'INVALID_PLATFORM_TYPE',
        details: {
          plan_id: planId,
          platform_type: plan.platform_type,
          reason: 'platform_type が internal ではありません',
        },
      });
    }

    // ステータスがactiveであることの確認
    if (plan.status !== 'active') {
      return badRequest400Response({
        message: 'デフォルトプランに設定できるのは、active ステータスのプランのみです',
        code: 'INVALID_PLAN_STATUS',
        details: {
          plan_id: planId,
          status: plan.status,
          reason: 'プランのステータスが active ではありません',
        },
      });
    }

    // 既にデフォルトプランの場合は成功レスポンスを返す（冪等性）
    if (plan.is_default) {
      return ok200Response({
        plan_id: plan.plan_id,
        internal_name: plan.internal_name,
        display_name: plan.display_name,
        is_default: true,
        previous_default_plan: null,
        updated_at: new Date(plan.updated_at).toISOString(),
        updated_by: adminResult.username,
      });
    }

    // 現在のデフォルトプランを取得
    const currentDefaultPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'getDefaultPlan',
      {}
    );

    // デフォルトプランを設定
    const updatedPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'setDefaultPlan',
      { planId }
    );

    if (!updatedPlan) {
      return internalServerError500Response({
        message: 'デフォルトプランの設定に失敗しました',
        code: 'UPDATE_FAILED',
        details: {},
      });
    }

    // TODO: 監査ログの記録
    console.log(
      `Default plan changed from ${currentDefaultPlan?.plan_id || 'none'} to ${updatedPlan.plan_id} by user ${adminResult.username}`
    );

    // レスポンスの構築
    return ok200Response({
      plan_id: updatedPlan.plan_id,
      internal_name: updatedPlan.internal_name,
      display_name: updatedPlan.display_name,
      is_default: true,
      previous_default_plan: currentDefaultPlan ? {
        plan_id: currentDefaultPlan.plan_id,
        internal_name: currentDefaultPlan.internal_name,
        display_name: currentDefaultPlan.display_name,
      } : null,
      updated_at: new Date(updatedPlan.updated_at).toISOString(),
      updated_by: adminResult.username,
    });
  } catch (error) {
    console.error('Error setting default plan:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};