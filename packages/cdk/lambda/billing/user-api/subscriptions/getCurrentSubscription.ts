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
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  ok200Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
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
function getApplicationPriority(
  source: UserPlanApplication['application_source']
): number {
  const priorities = {
    subscription: 5,
    manual: 4,
    campaign: 3,
    trial: 2,
    default: 1,
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
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
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
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    console.log('Request from user:', { tenantId, userId });

    // 2. ユーザのプラン適用情報を取得
    let applications: UserPlanApplication[];
    try {
      applications = await invokeDataAccessFunction<UserPlanApplication[]>(
        event,
        'user-plan-application',
        'findActiveByUserId',
        { userId }
      );
    } catch (error) {
      console.error('Error fetching user plan applications:', error);

      // データアクセスエラーの場合
      return internalServerError500Response({
        message: 'プラン適用情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 3. 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      // ステータスチェック
      if (
        !['active', 'scheduled_termination'].includes(app.application_status)
      ) {
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
      return notFound404Response({
        message: '有効なプランが見つかりません',
        code: 'NO_PLAN_FOUND',
        details: {
          userId,
          message: 'ユーザに適用されているプランが存在しません',
        },
      });
    }

    // 5. 最も優先度の高いプラン適用を選択
    const selectedApplication =
      selectHighestPriorityApplication(activeApplications);

    if (!selectedApplication) {
      return notFound404Response({
        message: '有効なプランが見つかりません',
        code: 'NO_PLAN_FOUND',
        details: undefined,
      });
    }

    console.log('Selected plan application:', {
      applicationId: selectedApplication.application_id,
      planId: selectedApplication.plan_id,
      source: selectedApplication.application_source,
      sourceId: selectedApplication.application_source_id,
      status: selectedApplication.application_status,
      validFrom: selectedApplication.valid_from,
      validUntil: selectedApplication.valid_until,
    });

    // 6. プランの詳細情報を取得
    let plan: Plan;
    try {
      const fetchedPlan = await invokeDataAccessFunction<Plan | null>(
        event,
        'plan',
        'findById',
        { id: selectedApplication.plan_id }
      );

      if (!fetchedPlan) {
        throw new Error(`Plan not found: ${selectedApplication.plan_id}`);
      }

      plan = fetchedPlan;
    } catch (error) {
      console.error('Error fetching plan details:', error);

      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'PLAN_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 7. サブスクリプション情報を取得（ソースがsubscriptionの場合）
    let subscription: Subscription | null = null;
    let nextBillingDate: string | null = null;
    let cancelAtPeriodEnd = false;
    let serviceEndDate: string | null = null;

    console.log('Checking subscription info:', {
      applicationSource: selectedApplication.application_source,
      applicationSourceId: selectedApplication.application_source_id,
      shouldFetchSubscription:
        selectedApplication.application_source === 'subscription' &&
        !!selectedApplication.application_source_id,
    });

    if (
      selectedApplication.application_source === 'subscription' &&
      selectedApplication.application_source_id
    ) {
      try {
        console.log('Fetching subscription by ID:', {
          subscriptionId: selectedApplication.application_source_id,
        });

        const fetchedSubscription = await invokeDataAccessFunction<Subscription | null>(
          event,
          'subscription',
          'findById',
          { subscriptionId: selectedApplication.application_source_id }
        );

        console.log('Subscription fetch result:', {
          found: !!fetchedSubscription,
          subscriptionId: fetchedSubscription?.subscription_id,
        });

        if (fetchedSubscription) {
          subscription = fetchedSubscription;

          console.log('Subscription details:', {
            subscriptionId: subscription.subscription_id,
            status: subscription.subscription_status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodEnd: subscription.current_period_end,
          });

          // 次回請求日の設定
          if (subscription.cancel_at_period_end) {
            // 解約予定の場合、次回請求はない
            nextBillingDate = null;
            cancelAtPeriodEnd = true;
            // Lambda間のJSONシリアライゼーションで既に文字列になっている可能性があるため、
            // 文字列として扱うか、必要に応じてDate型に変換
            serviceEndDate = typeof subscription.current_period_end === 'string'
              ? subscription.current_period_end
              : new Date(subscription.current_period_end).toISOString();
          } else {
            // 通常のサブスクリプションの場合
            nextBillingDate = typeof subscription.current_period_end === 'string'
              ? subscription.current_period_end
              : new Date(subscription.current_period_end).toISOString();
          }
        } else {
          console.warn('No subscription found for application_source_id:', {
            applicationSourceId: selectedApplication.application_source_id,
          });
        }
      } catch (error) {
        console.error('Error fetching subscription details:', error);
        // サブスクリプション情報の取得失敗は警告ログのみで続行
      }
    } else {
      console.log('Skipping subscription fetch:', {
        reason:
          selectedApplication.application_source !== 'subscription'
            ? 'application_source is not subscription'
            : 'application_source_id is null',
      });
    }

    // 8. レスポンスの構築
    const response: CurrentPlanResponse = {
      planId: plan.plan_id,
      planName: plan.internal_name,
      displayName: plan.display_name,
      status: selectedApplication.application_status,
      subscriptionId: subscription?.subscription_id || null,
      platformType: subscription?.platform_type || null,
      currentPeriodStart: subscription?.current_period_start
        ? (typeof subscription.current_period_start === 'string'
            ? subscription.current_period_start
            : new Date(subscription.current_period_start).toISOString())
        : null,
      currentPeriodEnd: subscription?.current_period_end
        ? (typeof subscription.current_period_end === 'string'
            ? subscription.current_period_end
            : new Date(subscription.current_period_end).toISOString())
        : null,
      nextBillingDate,
      cancelAtPeriodEnd,
      serviceEndDate,
      // 価格情報（Freeプランの場合は0円、それ以外は要件に応じて実装）
      amount: plan.internal_name === 'Freeプラン' ? 0 : 1000, // TODO: 価格情報を動的に取得
      currency: 'JPY',
      interval: 'month',
    };

    console.log('Returning current plan information:', {
      planId: response.planId,
      planName: response.planName,
      status: response.status,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in getCurrentSubscription:', error);

    // 認証エラーの場合
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    // その他の予期しないエラー
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
