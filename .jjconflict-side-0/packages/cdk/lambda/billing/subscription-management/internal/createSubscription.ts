/**
 * 内部用: サブスクリプション作成Lambda関数
 *
 * 統括責務の購入フローから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Subscription } from '../../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface CreateSubscriptionInput {
  userId: string;
  planId: string;
  platformType: 'stripe' | 'apple' | 'google';
  platformSubscriptionId: string;
  subscriptionStatus: 'active' | 'pending_verification';
  currentPeriodStart: string; // ISO 8601
  currentPeriodEnd: string; // ISO 8601
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface CreateSubscriptionOutput {
  subscriptionId: string;
  status: 'active' | 'pending_verification';
}

/**
 * エラークラス
 */
export class CreateSubscriptionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CreateSubscriptionError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: CreateSubscriptionInput
): Promise<CreateSubscriptionOutput> => {
  console.log('createSubscription input:', JSON.stringify(input, null, 2));

  try {
    // 入力バリデーション
    if (!input.userId || !input.planId || !input.platformSubscriptionId) {
      throw new CreateSubscriptionError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          userId: !!input.userId,
          planId: !!input.planId,
          platformSubscriptionId: !!input.platformSubscriptionId,
        }
      );
    }

    // 日付の検証とパース
    let periodStart: Date;
    let periodEnd: Date;
    try {
      periodStart = new Date(input.currentPeriodStart);
      periodEnd = new Date(input.currentPeriodEnd);

      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        throw new Error('Invalid date format');
      }

      if (periodEnd <= periodStart) {
        throw new Error('Period end must be after period start');
      }
    } catch (error) {
      throw new CreateSubscriptionError('INVALID_DATE', '無効な日付形式です', {
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 重複チェック: 同じplatform_subscription_idのサブスクリプションが既に存在しないか確認（データアクセス層Lambda関数を呼び出し）
    const existingSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'findByPlatformSubscriptionId',
        {
          platformSubscriptionId: input.platformSubscriptionId,
        }
      );

    if (existingSubscription) {
      throw new CreateSubscriptionError(
        'SUBSCRIPTION_ALREADY_EXISTS',
        '同じプラットフォームサブスクリプションIDのサブスクリプションが既に存在します',
        {
          existingSubscriptionId: existingSubscription.subscription_id,
          platformSubscriptionId: input.platformSubscriptionId,
        }
      );
    }

    // サブスクリプションを作成（データアクセス層Lambda関数を呼び出し）
    const newSubscription: Omit<
      Subscription,
      'subscription_id' | 'created_at' | 'updated_at'
    > = {
      user_id: input.userId,
      plan_id: input.planId,
      platform_type: input.platformType,
      platform_subscription_id: input.platformSubscriptionId,
      subscription_status: input.subscriptionStatus,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
    };

    const createdSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription>(
        input.tenantId,
        'subscription',
        'create',
        newSubscription
      );

    console.log('Subscription created successfully:', {
      subscriptionId: createdSubscription.subscription_id,
      status: createdSubscription.subscription_status,
    });

    return {
      subscriptionId: createdSubscription.subscription_id,
      status: createdSubscription.subscription_status as
        | 'active'
        | 'pending_verification',
    };
  } catch (error) {
    console.error('Error creating subscription:', error);

    // CreateSubscriptionErrorはそのままスロー
    if (error instanceof CreateSubscriptionError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new CreateSubscriptionError(
      'INTERNAL_ERROR',
      'サブスクリプション作成中に内部エラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
};
