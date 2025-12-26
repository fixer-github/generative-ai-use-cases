/**
 * 内部用: サブスクリプション期限延長Lambda関数
 *
 * 統括責務のWebhookイベントハンドラー（payment.succeeded）から呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Subscription } from '../../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface ExtendSubscriptionPeriodInput {
  subscriptionId: string;
  newPeriodStart: string; // ISO 8601
  newPeriodEnd: string; // ISO 8601
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface ExtendSubscriptionPeriodOutput {
  subscriptionId: string;
  currentPeriodEnd: string;
}

/**
 * エラークラス
 */
export class ExtendSubscriptionPeriodError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ExtendSubscriptionPeriodError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: ExtendSubscriptionPeriodInput
): Promise<ExtendSubscriptionPeriodOutput> => {
  console.log(
    'extendSubscriptionPeriod input:',
    JSON.stringify(input, null, 2)
  );

  try {
    // 入力バリデーション
    if (!input.subscriptionId || !input.newPeriodStart || !input.newPeriodEnd) {
      throw new ExtendSubscriptionPeriodError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          subscriptionId: !!input.subscriptionId,
          newPeriodStart: !!input.newPeriodStart,
          newPeriodEnd: !!input.newPeriodEnd,
        }
      );
    }

    // 日付の検証とパース
    let periodStart: Date;
    let periodEnd: Date;
    try {
      periodStart = new Date(input.newPeriodStart);
      periodEnd = new Date(input.newPeriodEnd);

      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        throw new Error('Invalid date format');
      }

      if (periodEnd <= periodStart) {
        throw new Error('Period end must be after period start');
      }
    } catch (error) {
      throw new ExtendSubscriptionPeriodError(
        'INVALID_DATE',
        '無効な日付形式です',
        {
          newPeriodStart: input.newPeriodStart,
          newPeriodEnd: input.newPeriodEnd,
          error: error instanceof Error ? error.message : 'Unknown error',
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
      throw new ExtendSubscriptionPeriodError(
        'SUBSCRIPTION_NOT_FOUND',
        '指定されたサブスクリプションが見つかりません',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    // scheduled_cancellation（cancel_at_period_end: true）の場合は延長しない
    if (existingSubscription.cancel_at_period_end) {
      console.log(
        'Subscription is scheduled for cancellation, skipping period extension:',
        {
          subscriptionId: input.subscriptionId,
          cancelAtPeriodEnd: existingSubscription.cancel_at_period_end,
        }
      );

      return {
        subscriptionId: existingSubscription.subscription_id,
        currentPeriodEnd: new Date(existingSubscription.current_period_end).toISOString(),
      };
    }

    // 期限を延長（データアクセス層Lambda関数を呼び出し）
    const updatedSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'extendPeriod',
        {
          subscriptionId: input.subscriptionId,
          newPeriodStart: periodStart.toISOString(),
          newPeriodEnd: periodEnd.toISOString(),
        }
      );

    if (!updatedSubscription) {
      throw new ExtendSubscriptionPeriodError(
        'UPDATE_FAILED',
        'サブスクリプションの期限延長に失敗しました',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    console.log('Subscription period extended successfully:', {
      subscriptionId: updatedSubscription.subscription_id,
      previousPeriodEnd: new Date(existingSubscription.current_period_end).toISOString(),
      newPeriodEnd: new Date(updatedSubscription.current_period_end).toISOString(),
    });

    return {
      subscriptionId: updatedSubscription.subscription_id,
      currentPeriodEnd: new Date(updatedSubscription.current_period_end).toISOString(),
    };
  } catch (error) {
    console.error('Error extending subscription period:', error);

    // ExtendSubscriptionPeriodErrorはそのままスロー
    if (error instanceof ExtendSubscriptionPeriodError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new ExtendSubscriptionPeriodError(
      'INTERNAL_ERROR',
      'サブスクリプション期限延長中に内部エラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
};
