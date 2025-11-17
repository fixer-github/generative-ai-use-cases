/**
 * 内部用: サブスクリプション取得Lambda関数
 *
 * 統括責務のプラン変更フロー・解約フローから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Subscription } from '../../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface GetSubscriptionInput {
  subscriptionId: string;
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface GetSubscriptionOutput {
  subscription: {
    subscriptionId: string;
    userId: string;
    planId: string;
    platformType: 'stripe' | 'apple' | 'google';
    platformSubscriptionId: string;
    subscriptionStatus: Subscription['subscription_status'];
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * エラークラス
 */
export class GetSubscriptionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'GetSubscriptionError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: GetSubscriptionInput
): Promise<GetSubscriptionOutput> => {
  console.log('getSubscription input:', JSON.stringify(input, null, 2));

  try {
    // 入力バリデーション
    if (!input.subscriptionId) {
      throw new GetSubscriptionError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          subscriptionId: !!input.subscriptionId,
        }
      );
    }

    // サブスクリプションを取得（データアクセス層Lambda関数を呼び出し）
    const subscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'findById',
        { subscriptionId: input.subscriptionId }
      );

    if (!subscription) {
      throw new GetSubscriptionError(
        'SUBSCRIPTION_NOT_FOUND',
        '指定されたサブスクリプションが見つかりません',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    console.log('Subscription retrieved successfully:', {
      subscriptionId: subscription.subscription_id,
      status: subscription.subscription_status,
    });

    return {
      subscription: {
        subscriptionId: subscription.subscription_id,
        userId: subscription.user_id,
        planId: subscription.plan_id,
        platformType: subscription.platform_type,
        platformSubscriptionId: subscription.platform_subscription_id,
        subscriptionStatus: subscription.subscription_status,
        currentPeriodStart: subscription.current_period_start.toISOString(),
        currentPeriodEnd: subscription.current_period_end.toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        createdAt: subscription.created_at.toISOString(),
        updatedAt: subscription.updated_at.toISOString(),
      },
    };
  } catch (error) {
    console.error('Error getting subscription:', error);

    // GetSubscriptionErrorはそのままスロー
    if (error instanceof GetSubscriptionError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new GetSubscriptionError(
      'INTERNAL_ERROR',
      'サブスクリプション取得中に内部エラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
};
