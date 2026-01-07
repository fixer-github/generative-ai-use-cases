/**
 * User-facing Reactivate Subscription API
 *
 * ユーザ向けのサブスクリプション再有効化API。
 * キャンセル予約されたサブスクリプション（cancel_at_period_end: true）を
 * 通常の状態（cancel_at_period_end: false）に戻します。
 *
 * 主なユースケース:
 * - 解約予約後にプラン変更を行いたい場合、先に解約予約を取り消す必要がある
 * - ユーザーが解約予約を取り消して継続したい場合
 *
 * Frontend API Contract:
 * - Request: { subscriptionId: string }
 * - Response: { success: boolean, subscriptionId: string, message: string }
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Subscription } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

/**
 * リクエストボディの型
 */
interface ReactivateSubscriptionRequest {
  /** サブスクリプションID */
  subscriptionId: string;
}

/**
 * レスポンスボディの型
 */
interface ReactivateSubscriptionResponse {
  /** 成功フラグ */
  success: boolean;
  /** サブスクリプションID */
  subscriptionId: string;
  /** メッセージ */
  message: string;
}

/**
 * シークレットのキャッシュ
 */
const stripeApiKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} is empty`);
    }

    const secret = JSON.parse(response.SecretString);
    stripeApiKeyCache[tenantId] = secret.apiKey;

    return secret.apiKey;
  } catch (error) {
    console.error('Failed to retrieve Stripe API key:', error);
    throw new Error('Failed to retrieve payment configuration');
  }
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Reactivate Subscription request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    let requestBody: ReactivateSubscriptionRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { subscriptionId } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!subscriptionId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'subscriptionId',
          reason: 'subscriptionIdは必須です',
        },
      });
    }

    console.log('Reactivation request validated:', { subscriptionId });

    // 4. サブスクリプション情報をデータベースから取得
    const subscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'findById',
      { subscriptionId }
    );

    if (!subscription) {
      console.error('Subscription not found:', { subscriptionId });
      return notFound404Response({
        message: 'サブスクリプションが見つかりません',
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    }

    // 5. サブスクリプションの所有者確認
    if (subscription.user_id !== userId) {
      console.error('Subscription does not belong to user:', {
        subscriptionId,
        subscriptionUserId: subscription.user_id,
        requestUserId: userId,
      });
      return unauthorized401Response({
        message: 'このサブスクリプションへのアクセス権がありません',
        code: 'UNAUTHORIZED',
      });
    }

    // 6. サブスクリプションがキャンセル予約状態かチェック
    if (!subscription.cancel_at_period_end) {
      console.log('Subscription is not scheduled for cancellation:', {
        subscriptionId,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });
      return badRequest400Response({
        message: 'このサブスクリプションは解約予約されていません',
        code: 'NOT_SCHEDULED_FOR_CANCELLATION',
      });
    }

    // 7. Stripeプラットフォームのみ対応
    if (subscription.platform_type !== 'stripe') {
      return badRequest400Response({
        message: 'Web版のみサブスクリプション再有効化に対応しています',
        code: 'UNSUPPORTED_PLATFORM',
      });
    }

    // 8. Stripe APIを初期化
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 9. Stripeでキャンセル予約を取り消す（cancel_at_period_end を false に）
    console.log('Reactivating subscription on Stripe:', {
      platformSubscriptionId: subscription.platform_subscription_id,
    });

    const updatedStripeSubscription = await stripe.subscriptions.update(
      subscription.platform_subscription_id,
      {
        cancel_at_period_end: false,
      }
    );

    console.log('Stripe subscription reactivated:', {
      id: updatedStripeSubscription.id,
      cancelAtPeriodEnd: updatedStripeSubscription.cancel_at_period_end,
    });

    // 10. ローカルDBのサブスクリプション情報を更新
    const updatedSubscription = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'update',
      {
        subscriptionId,
        updates: {
          cancel_at_period_end: false,
          subscription_status: 'active', // scheduled_cancellation から active に戻す
        },
      }
    );

    if (!updatedSubscription) {
      // Stripeは更新成功したがDBの更新に失敗した場合
      // 次回のWebhookで同期される可能性があるのでエラーではなく警告
      console.warn(
        'Failed to update local database, but Stripe was updated successfully:',
        { subscriptionId }
      );
    }

    // 11. プラン適用のステータスも更新（scheduled_termination から active に戻す）
    try {
      const planApplications = await invokeDataAccessFunction<any[]>(
        event,
        'user-plan-application',
        'findByApplicationSourceId',
        { sourceId: subscriptionId }
      );

      if (planApplications && planApplications.length > 0) {
        const activePlanApplication = planApplications.find(
          (app) =>
            app.application_status === 'scheduled_termination' ||
            app.application_status === 'active'
        );

        if (
          activePlanApplication &&
          activePlanApplication.application_status === 'scheduled_termination'
        ) {
          await invokeDataAccessFunction(
            event,
            'user-plan-application',
            'update',
            {
              applicationId: activePlanApplication.application_id,
              updates: {
                application_status: 'active',
              },
            }
          );
          console.log('Plan application status updated to active:', {
            applicationId: activePlanApplication.application_id,
          });
        }
      }
    } catch (error) {
      // プラン適用の更新に失敗してもエラーにはしない（次回のWebhookで同期される）
      console.warn('Failed to update plan application status:', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 12. 成功レスポンスを返す
    const response: ReactivateSubscriptionResponse = {
      success: true,
      subscriptionId,
      message:
        'サブスクリプションの解約予約が取り消されました。引き続きご利用いただけます。',
    };

    console.log('Reactivate subscription completed successfully:', {
      subscriptionId,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in reactivateSubscription:', error);

    // Stripeのエラーを適切に処理
    if (error instanceof Stripe.errors.StripeError) {
      return badRequest400Response({
        message: error.message,
        code: 'STRIPE_ERROR',
        details: {
          type: error.type,
          code: error.code,
        },
      });
    }

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
