/**
 * 内部用: サブスクリプション状態更新Lambda関数
 *
 * 統括責務のWebhookイベントハンドラーから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { SubscriptionRepository } from '../../../repositories';
import { getRdsConnection } from '../../../utils/rdsConnection';
import { Subscription } from '../../../repositories/types';

/**
 * 入力パラメータ
 */
export interface UpdateSubscriptionStatusInput {
  subscriptionId: string;
  newStatus: 'active' | 'past_due' | 'canceled' | 'expired';
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
      'expired',
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

    // RDS接続設定の取得
    const rdsConnection = await getRdsConnection({
      requestContext: {
        authorizer: {
          claims: {
            'custom:tenant_id': input.tenantId,
          },
        },
      },
    } as any);

    const subscriptionRepository = new SubscriptionRepository(rdsConnection);

    // サブスクリプションの存在確認
    const existingSubscription = await subscriptionRepository.findById(
      input.subscriptionId
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
        updatedAt: existingSubscription.updated_at.toISOString(),
      };
    }

    // ステータスを更新
    const updatedSubscription = await subscriptionRepository.update(
      input.subscriptionId,
      {
        subscription_status:
          input.newStatus as Subscription['subscription_status'],
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
      updatedAt: updatedSubscription.updated_at.toISOString(),
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
