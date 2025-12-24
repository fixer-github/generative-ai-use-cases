/**
 * User-facing Change Subscription Plan API
 *
 * ユーザ向けのプラン変更API。
 * 現在のサブスクリプションから新しいプランへの変更を処理します。
 * アップグレードは即座に（日割り計算）、ダウングレードは次回更新時に適用されます。
 *
 * Frontend API Contract:
 * - Request: { newPlanId: string }
 * - Response: { success, subscriptionId, planId, displayName, message, prorationAmount?, effectiveDate }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  ok200Response,
  unauthorized401Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  PlanChangeFlowInput,
  PlanChangeFlowOutput,
} from '../../orchestration/types/flowTypes';
import {
  Plan,
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';

/**
 * リクエストボディの型（フロントエンドAPI契約）
 */
interface ChangePlanRequest {
  /** 変更先のプランID */
  newPlanId: string;
}

/**
 * レスポンスボディの型（フロントエンドAPI契約）
 */
interface ChangePlanResponse {
  /** 成功フラグ */
  success: boolean;
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しいプランID */
  planId: string;
  /** プランの表示名 */
  displayName: string;
  /** メッセージ */
  message: string;
  /** プロレーション（日割り計算）金額（オプション） */
  prorationAmount?: number;
  /** 変更が有効になる日時（ISO 8601形式） */
  effectiveDate: string;
}

/**
 * エラーレスポンスの型
 */
interface ErrorResponse {
  message: string;
  code: string;
  details?: unknown;
}

// Lambda client instance
const lambdaClient = new LambdaClient({});

// Stripe API key cache
let stripeApiKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string | null> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      console.log(`Secret ${secretName} is empty`);
      return null;
    }

    const secret = JSON.parse(response.SecretString);
    if (!secret.apiKey) {
      console.log(`API key not configured for tenant ${tenantId}`);
      return null;
    }

    stripeApiKeyCache[tenantId] = secret.apiKey;
    return secret.apiKey;
  } catch (error) {
    console.error('Failed to retrieve Stripe API key:', error);
    return null;
  }
}

/**
 * 最も優先度の高いプラン適用を選択する関数
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

function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  const sorted = [...applications].sort((a, b) => {
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return sorted[0];
}

/**
 * Stripeのプロレーション金額をプレビューする
 */
async function getProrationPreview(
  tenantId: string,
  platformSubscriptionId: string,
  newPriceId: string
): Promise<number | null> {
  try {
    const apiKey = await getStripeApiKey(tenantId);
    if (!apiKey) {
      console.log('Stripe API key not available for proration preview');
      return null;
    }

    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 現在のサブスクリプションを取得
    const subscription = await stripe.subscriptions.retrieve(platformSubscriptionId);

    // サブスクリプションアイテムを取得
    const subscriptionItemId = subscription.items.data[0]?.id;
    if (!subscriptionItemId) {
      console.log('No subscription item found for proration preview');
      return null;
    }

    // 次回インボイスのプレビューを取得
    const upcomingInvoice = await stripe.invoices.createPreview({
      subscription: platformSubscriptionId,
      subscription_details: {
        items: [
          {
            id: subscriptionItemId,
            price: newPriceId,
          },
        ],
        proration_behavior: 'always_invoice',
      },
    });

    // プロレーション行の金額を合計
    // Proration lines have negative amounts for credit and positive for charges
    let prorationAmount = 0;
    for (const line of upcomingInvoice.lines.data) {
      if (line.proration) {
        prorationAmount += line.amount;
      }
    }

    console.log('Proration preview calculated:', {
      platformSubscriptionId,
      newPriceId,
      prorationAmount,
    });

    return prorationAmount;
  } catch (error) {
    console.error('Failed to get proration preview:', error);
    return null;
  }
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Change Subscription Plan request received');

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

    let requestBody: ChangePlanRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { newPlanId } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!newPlanId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'newPlanId',
          reason: 'newPlanIdは必須です',
        },
      });
    }

    // 4. 現在のプラン適用情報を取得
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
      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      if (!['active', 'scheduled_termination'].includes(app.application_status)) {
        return false;
      }
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }
      return true;
    });

    // 最も優先度の高いプラン適用を選択
    const highestPriorityApplication = selectHighestPriorityApplication(activeApplications);

    if (!highestPriorityApplication) {
      return notFound404Response({
        message: '現在有効なプランがありません',
        code: 'NO_ACTIVE_PLAN',
      });
    }

    const currentPlanId = highestPriorityApplication.plan_id;

    // 5. 同じプランへの変更をチェック
    if (currentPlanId === newPlanId) {
      return badRequest400Response({
        message: '同じプランへの変更はできません',
        code: 'SAME_PLAN',
        details: {
          currentPlanId,
          newPlanId,
        },
      });
    }

    // 6. サブスクリプションベースのプランか確認し、サブスクリプション情報を取得
    if (highestPriorityApplication.application_source !== 'subscription') {
      return badRequest400Response({
        message: 'サブスクリプションベースのプランのみ変更可能です',
        code: 'NOT_SUBSCRIPTION_PLAN',
        details: {
          applicationSource: highestPriorityApplication.application_source,
        },
      });
    }

    if (!highestPriorityApplication.application_source_id) {
      return internalServerError500Response({
        message: 'サブスクリプションIDが見つかりません',
        code: 'MISSING_SUBSCRIPTION_ID',
      });
    }

    const subscriptionId = highestPriorityApplication.application_source_id;

    // サブスクリプション情報を取得
    let subscription: Subscription | null;
    try {
      subscription = await invokeDataAccessFunction<Subscription | null>(
        event,
        'subscription',
        'findById',
        { subscriptionId }
      );
    } catch (error) {
      console.error('Error fetching subscription:', error);
      return internalServerError500Response({
        message: 'サブスクリプション情報の取得に失敗しました',
        code: 'SUBSCRIPTION_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (!subscription) {
      return notFound404Response({
        message: 'アクティブなサブスクリプションが見つかりません',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    }

    // 7. 新しいプランの情報を取得
    let newPlan: Plan | null;
    try {
      newPlan = await invokeDataAccessFunction<Plan | null>(
        event,
        'plan',
        'findById',
        { id: newPlanId }
      );
    } catch (error) {
      console.error('Error fetching new plan:', error);
      return internalServerError500Response({
        message: '新しいプラン情報の取得に失敗しました',
        code: 'PLAN_FETCH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (!newPlan) {
      return badRequest400Response({
        message: '指定されたプランが見つかりません',
        code: 'INVALID_PLAN',
        details: {
          planId: newPlanId,
        },
      });
    }

    console.log('Plan change request validated:', {
      currentPlanId,
      newPlanId,
      subscriptionId,
      platformSubscriptionId: subscription.platform_subscription_id,
    });

    // 8. Stripeのプロレーション金額をプレビュー（Stripeプラットフォームの場合）
    let prorationAmount: number | undefined;
    if (
      subscription.platform_type === 'stripe' &&
      subscription.platform_subscription_id &&
      newPlan.platform_product_id
    ) {
      const prorationPreview = await getProrationPreview(
        tenantId,
        subscription.platform_subscription_id,
        newPlan.platform_product_id
      );
      if (prorationPreview !== null) {
        prorationAmount = prorationPreview;
      }
    }

    // 9. Plan Change Flowを呼び出す
    const planChangeFlowFunctionName = process.env.PLAN_CHANGE_FLOW_FUNCTION_NAME;

    if (!planChangeFlowFunctionName) {
      console.error('PLAN_CHANGE_FLOW_FUNCTION_NAME is not configured');
      return internalServerError500Response({
        message: 'サーバー設定エラーが発生しました',
        code: 'CONFIGURATION_ERROR',
      });
    }

    const flowInput: PlanChangeFlowInput = {
      tenantId,
      userId,
      currentPlanId,
      newPlanId,
      subscriptionId,
    };

    console.log('Invoking plan change flow:', {
      functionName: planChangeFlowFunctionName,
      input: flowInput,
    });

    const invokeCommand = new InvokeCommand({
      FunctionName: planChangeFlowFunctionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(flowInput),
    });

    const invokeResult = await lambdaClient.send(invokeCommand);

    // 10. Lambda呼び出し結果の処理
    if (invokeResult.FunctionError) {
      console.error('Plan change flow function error:', {
        functionError: invokeResult.FunctionError,
        payload: invokeResult.Payload
          ? new TextDecoder().decode(invokeResult.Payload)
          : null,
      });

      return internalServerError500Response({
        message: 'プラン変更処理中にエラーが発生しました',
        code: 'PLAN_CHANGE_FLOW_ERROR',
        details: {
          functionError: invokeResult.FunctionError,
        },
      });
    }

    if (!invokeResult.Payload) {
      console.error('Plan change flow returned no payload');
      return internalServerError500Response({
        message: 'プラン変更処理からのレスポンスが不正です',
        code: 'INVALID_FLOW_RESPONSE',
      });
    }

    const flowOutput: PlanChangeFlowOutput = JSON.parse(
      new TextDecoder().decode(invokeResult.Payload)
    );

    console.log('Plan change flow completed:', {
      success: flowOutput.success,
      flowExecutionId: flowOutput.flowExecutionId,
      changeType: flowOutput.changeType,
    });

    // 11. フロー実行結果の確認
    if (!flowOutput.success) {
      console.error('Plan change flow failed:', {
        flowExecutionId: flowOutput.flowExecutionId,
        errorDetails: flowOutput.errorDetails,
      });

      return internalServerError500Response({
        message:
          flowOutput.errorDetails?.errorMessage || 'プラン変更処理に失敗しました',
        code: flowOutput.errorDetails?.errorCode || 'PLAN_CHANGE_FAILED',
        details: {
          flowExecutionId: flowOutput.flowExecutionId,
        },
      });
    }

    // 12. 成功レスポンスを返す（フロントエンドAPI契約に準拠）
    const message =
      flowOutput.changeType === 'upgrade'
        ? 'プランがアップグレードされました。新しいプランは即座に有効になります。'
        : 'プランのダウングレードが予約されました。現在の請求期間終了時に新しいプランに切り替わります。';

    const response: ChangePlanResponse = {
      success: true,
      subscriptionId,
      planId: newPlanId,
      displayName: newPlan.display_name,
      message,
      effectiveDate: flowOutput.effectiveDate,
    };

    // プロレーション金額がある場合は追加
    if (prorationAmount !== undefined) {
      response.prorationAmount = prorationAmount;
    }

    console.log('Plan change completed successfully:', {
      subscriptionId,
      planId: newPlanId,
      displayName: newPlan.display_name,
      changeType: flowOutput.changeType,
      effectiveDate: flowOutput.effectiveDate,
      prorationAmount,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Unexpected error in changeSubscriptionPlan:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
