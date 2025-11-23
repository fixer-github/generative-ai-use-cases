/**
 * 現在のプラン情報取得API
 *
 * ログイン中のユーザが現在どのプランに入っているか、
 * サブスクリプションの状態はどうか、次回請求日はいつか、などの情報を取得します。
 *
 * 重要：対象のユーザに適用されているプランが存在していない場合、
 * デフォルトプランにフォールバックすることは絶対に行わず、エラーを返します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  Subscription,
  UserPlanApplication
} from '../../data-access/repositories/types';
import { CORS_HEADERS } from '../../../utils/apiResponse';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';

/**
 * 現在のプラン情報のレスポンス型
 */
interface CurrentPlanResponse {
  planId: string;
  planName: string;
  displayName: string;
  status: string;
  subscriptionId: string | null;
  platformType: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  serviceEndDate?: string | null;
  amount: number;
  currency: string;
  interval: string;
}

/**
 * プラン適用の優先順位を決定する
 */
function getApplicationPriority(source: UserPlanApplication['application_source']): number {
  const priorities = {
    'subscription': 5,
    'manual': 4,
    'campaign': 3,
    'trial': 2,
    'default': 1
  };
  return priorities[source] || 0;
}

/**
 * 最も優先度の高いプラン適用を選択する
 */
function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  // 優先順位でソート（高い順）
  const sorted = [...applications].sort((a, b) => {
    const priorityDiff = getApplicationPriority(b.application_source) - getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    // 同じ優先度の場合は作成日時が新しい方を優先
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return sorted[0];
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Get Current Subscription API request received');

  try {
    // 1. 認証確認（CognitoトークンからユーザIDとテナントIDを取得）
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です'
          }
        })
      };
    }

    console.log('Request from user:', { tenantId, userId });

    // 2. ユーザのプラン適用情報を取得
    let applications: UserPlanApplication[];
    try {
      applications = await invokeDataAccessFunction<UserPlanApplication[]>(
        event,
        'user-plan-application',
        'findActiveByUser',
        { userId }
      );
    } catch (error) {
      console.error('Error fetching user plan applications:', error);

      // データアクセスエラーの場合
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'DATA_ACCESS_ERROR',
            message: 'プラン適用情報の取得に失敗しました',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        })
      };
    }

    // 3. 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter(app => {
      // ステータスチェック
      if (!['active', 'scheduled_termination'].includes(app.application_status)) {
        return false;
      }

      // 有効期限チェック
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }

      // 有効開始日チェック
      const validFrom = new Date(app.valid_from);
      if (validFrom > now) {
        return false;
      }

      return true;
    });

    console.log(`Found ${activeApplications.length} active plan applications`);

    // 4. プラン適用が存在しない場合はエラーを返す（デフォルトプランへのフォールバックなし）
    if (activeApplications.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'NO_PLAN_FOUND',
            message: '有効なプランが見つかりません',
            details: {
              userId,
              message: 'ユーザに適用されているプランが存在しません'
            }
          }
        })
      };
    }

    // 5. 最も優先度の高いプラン適用を選択
    const selectedApplication = selectHighestPriorityApplication(activeApplications);

    if (!selectedApplication) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'NO_PLAN_FOUND',
            message: '有効なプランが見つかりません'
          }
        })
      };
    }

    console.log('Selected plan application:', {
      applicationId: selectedApplication.application_id,
      planId: selectedApplication.plan_id,
      source: selectedApplication.application_source
    });

    // 6. プランの詳細情報を取得
    let plan: Plan;
    try {
      const plans = await invokeDataAccessFunction<Plan[]>(
        event,
        'plan',
        'findById',
        { planId: selectedApplication.plan_id }
      );

      if (!plans || plans.length === 0) {
        throw new Error(`Plan not found: ${selectedApplication.plan_id}`);
      }

      plan = plans[0];
    } catch (error) {
      console.error('Error fetching plan details:', error);

      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PLAN_FETCH_ERROR',
            message: 'プラン情報の取得に失敗しました',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        })
      };
    }

    // 7. サブスクリプション情報を取得（ソースがsubscriptionの場合）
    let subscription: Subscription | null = null;
    let nextBillingDate: string | null = null;
    let cancelAtPeriodEnd = false;
    let serviceEndDate: string | null = null;

    if (selectedApplication.application_source === 'subscription' &&
        selectedApplication.application_source_id) {
      try {
        const subscriptions = await invokeDataAccessFunction<Subscription[]>(
          event,
          'subscription',
          'findById',
          { subscriptionId: selectedApplication.application_source_id }
        );

        if (subscriptions && subscriptions.length > 0) {
          subscription = subscriptions[0];

          // 次回請求日の設定
          if (subscription.cancel_at_period_end) {
            // 解約予定の場合、次回請求はない
            nextBillingDate = null;
            cancelAtPeriodEnd = true;
            serviceEndDate = subscription.current_period_end.toISOString();
          } else {
            // 通常のサブスクリプションの場合
            nextBillingDate = subscription.current_period_end.toISOString();
          }
        }
      } catch (error) {
        console.warn('Error fetching subscription details:', error);
        // サブスクリプション情報の取得失敗は警告ログのみで続行
      }
    }

    // 8. レスポンスの構築
    const response: CurrentPlanResponse = {
      planId: plan.plan_id,
      planName: plan.internal_name,
      displayName: plan.display_name,
      status: selectedApplication.application_status,
      subscriptionId: subscription?.subscription_id || null,
      platformType: subscription?.platform_type || null,
      currentPeriodStart: subscription?.current_period_start?.toISOString() || null,
      currentPeriodEnd: subscription?.current_period_end?.toISOString() || null,
      nextBillingDate,
      cancelAtPeriodEnd,
      serviceEndDate,
      // 価格情報（Freeプランの場合は0円、それ以外は要件に応じて実装）
      amount: plan.internal_name === 'Freeプラン' ? 0 : 1000, // TODO: 価格情報を動的に取得
      currency: 'JPY',
      interval: 'month'
    };

    console.log('Returning current plan information:', {
      planId: response.planId,
      planName: response.planName,
      status: response.status
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Unexpected error in getCurrentSubscription:', error);

    // 認証エラーの場合
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です'
          }
        })
      };
    }

    // その他の予期しないエラー
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    };
  }
};