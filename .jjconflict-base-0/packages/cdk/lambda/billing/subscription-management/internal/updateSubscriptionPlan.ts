/**
 * 内部用: サブスクリプションプラン更新Lambda関数
 *
 * プラン変更フローから呼び出され、サブスクリプションのplan_idを更新します。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Subscription } from '../../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface UpdateSubscriptionPlanInput {
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しいプランID */
  newPlanId: string;
  /** テナントID（RDS接続に必要） */
  tenantId: string;
}

/**
 * 出力パラメータ
 */
export interface UpdateSubscriptionPlanOutput {
  /** サブスクリプションID */
  subscriptionId: string;
  /** 以前のプランID */
  previousPlanId: string;
  /** 新しいプランID */
  newPlanId: string;
  /** 更新日時（ISO 8601形式） */
  updatedAt: string;
}

/**
 * エラークラス
 */
export class UpdateSubscriptionPlanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'UpdateSubscriptionPlanError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: UpdateSubscriptionPlanInput
): Promise<UpdateSubscriptionPlanOutput> => {
  console.log(
    'updateSubscriptionPlan input:',
    JSON.stringify(input, null, 2)
  );

  try {
    // 入力バリデーション
    if (!input.subscriptionId || !input.newPlanId || !input.tenantId) {
      throw new UpdateSubscriptionPlanError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          subscriptionId: !!input.subscriptionId,
          newPlanId: !!input.newPlanId,
          tenantId: !!input.tenantId,
        }
      );
    }

    // サブスクリプションの存在確認（データアクセス層Lambda関数を呼び出し）
    const existingSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'findById',
        {
          subscriptionId: input.subscriptionId,
        }
      );

    if (!existingSubscription) {
      throw new UpdateSubscriptionPlanError(
        'SUBSCRIPTION_NOT_FOUND',
        '指定されたサブスクリプションが見つかりません',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    const previousPlanId = existingSubscription.plan_id;

    // 同じプランへの更新は許可（冪等性のため）
    if (previousPlanId === input.newPlanId) {
      console.log('Plan is already the same, skipping update:', {
        subscriptionId: input.subscriptionId,
        planId: previousPlanId,
      });

      return {
        subscriptionId: existingSubscription.subscription_id,
        previousPlanId,
        newPlanId: input.newPlanId,
        updatedAt: typeof existingSubscription.updated_at === 'string'
          ? existingSubscription.updated_at
          : existingSubscription.updated_at.toISOString(),
      };
    }

    // プランIDを更新（データアクセス層Lambda関数を呼び出し）
    const updatedSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'update',
        {
          subscriptionId: input.subscriptionId,
          updates: {
            plan_id: input.newPlanId,
          },
        }
      );

    if (!updatedSubscription) {
      throw new UpdateSubscriptionPlanError(
        'UPDATE_FAILED',
        'サブスクリプションのプラン更新に失敗しました',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    console.log('Subscription plan updated successfully:', {
      subscriptionId: updatedSubscription.subscription_id,
      previousPlanId,
      newPlanId: updatedSubscription.plan_id,
    });

    return {
      subscriptionId: updatedSubscription.subscription_id,
      previousPlanId,
      newPlanId: updatedSubscription.plan_id,
      updatedAt: typeof updatedSubscription.updated_at === 'string'
        ? updatedSubscription.updated_at
        : updatedSubscription.updated_at.toISOString(),
    };
  } catch (error) {
    console.error('Error updating subscription plan:', error);

    // UpdateSubscriptionPlanErrorはそのままスロー
    if (error instanceof UpdateSubscriptionPlanError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new UpdateSubscriptionPlanError(
      'INTERNAL_ERROR',
      'サブスクリプションプラン更新中に内部エラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
};
