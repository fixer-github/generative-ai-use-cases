/**
 * 内部用: サブスクリプション状態更新Lambda関数
 *
 * 統括責務のWebhookイベントハンドラーから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Subscription } from '../../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface UpdateSubscriptionStatusInput {
  subscriptionId: string;
  newStatus: 'active' | 'past_due' | 'canceled' | 'scheduled_cancellation' | 'expired' | 'rolled_back';
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface UpdateSubscriptionStatusOutput {
  subscriptionId: string;
  previousStatus: string;
  newStatus: string;
  updatedAt: string;
}

/**
 * エラークラス
 */
export class UpdateSubscriptionStatusError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'UpdateSubscriptionStatusError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: UpdateSubscriptionStatusInput
): Promise<UpdateSubscriptionStatusOutput> => {
  console.log(
    'updateSubscriptionStatus input:',
    JSON.stringify(input, null, 2)
  );

  try {
    // 入力バリデーション
    if (!input.subscriptionId || !input.newStatus) {
      throw new UpdateSubscriptionStatusError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          subscriptionId: !!input.subscriptionId,
          newStatus: !!input.newStatus,
        }
      );
    }

    // ステータスの検証
    const validStatuses: Array<Subscription['subscription_status']> = [
      'active',
      'past_due',
      'canceled',
      'scheduled_cancellation',
      'expired',
      'rolled_back',
    ];

    if (!validStatuses.includes(input.newStatus as any)) {
      throw new UpdateSubscriptionStatusError(
        'INVALID_STATUS',
        '無効なステータスが指定されています',
        {
          newStatus: input.newStatus,
          validStatuses,
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
      throw new UpdateSubscriptionStatusError(
        'SUBSCRIPTION_NOT_FOUND',
        '指定されたサブスクリプションが見つかりません',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    // 状態遷移の妥当性チェック
    const previousStatus = existingSubscription.subscription_status;

    // 同じステータスへの更新は許可（冪等性のため）
    if (previousStatus === input.newStatus) {
      console.log('Status is already the same, skipping update:', {
        subscriptionId: input.subscriptionId,
        status: previousStatus,
      });

      return {
        subscriptionId: existingSubscription.subscription_id,
        previousStatus,
        newStatus: input.newStatus,
        updatedAt: typeof existingSubscription.updated_at === 'string'
          ? existingSubscription.updated_at
          : existingSubscription.updated_at.toISOString(),
      };
    }

    // ステータスを更新（データアクセス層Lambda関数を呼び出し）
    // scheduled_cancellation への遷移時は cancel_at_period_end も true に設定
    // active への遷移時は cancel_at_period_end を false にリセット
    const updates: Partial<Subscription> = {
      subscription_status:
        input.newStatus as Subscription['subscription_status'],
    };

    if (input.newStatus === 'scheduled_cancellation') {
      updates.cancel_at_period_end = true;
    } else if (input.newStatus === 'active') {
      // activeに戻る場合は解約予定フラグをリセット
      updates.cancel_at_period_end = false;
    }

    const updatedSubscription =
      await invokeDataAccessFunctionByTenantId<Subscription | null>(
        input.tenantId,
        'subscription',
        'update',
        {
          subscriptionId: input.subscriptionId,
          updates,
        }
      );

    if (!updatedSubscription) {
      throw new UpdateSubscriptionStatusError(
        'UPDATE_FAILED',
        'サブスクリプションの更新に失敗しました',
        {
          subscriptionId: input.subscriptionId,
        }
      );
    }

    console.log('Subscription status updated successfully:', {
      subscriptionId: updatedSubscription.subscription_id,
      previousStatus,
      newStatus: updatedSubscription.subscription_status,
    });

    return {
      subscriptionId: updatedSubscription.subscription_id,
      previousStatus,
      newStatus: updatedSubscription.subscription_status,
      updatedAt: typeof updatedSubscription.updated_at === 'string'
        ? updatedSubscription.updated_at
        : updatedSubscription.updated_at.toISOString(),
    };
  } catch (error) {
    console.error('Error updating subscription status:', error);

    // UpdateSubscriptionStatusErrorはそのままスロー
    if (error instanceof UpdateSubscriptionStatusError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new UpdateSubscriptionStatusError(
      'INTERNAL_ERROR',
      'サブスクリプション状態更新中に内部エラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }
};
