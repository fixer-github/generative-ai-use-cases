/**
 * Webhook Event Flow Orchestration Lambda Handler
 *
 * Webhookイベント処理フローを統括するLambda関数。
 * 決済システム（Stripe/Apple/Google）から送られてくるWebhookイベントを処理する一連の流れを制御します。
 *
 * 起動トリガー: EventBridge経由で起動（署名検証済みWebhookイベントを受信）
 *
 * 処理イベントタイプ:
 * 1. payment.succeeded（更新成功）
 *    - サブスクリプション有効期限延長
 *    - プラン適用有効期限延長（scheduled_terminationの場合はスキップ）
 *    - 支払い履歴記録（サブスク管理内で実施）
 *
 * 2. payment.failed（支払い失敗）
 *    - サブスクリプション状態更新（status: 'past_due'）
 *    - 支払い失敗履歴記録
 *
 * 3. subscription.canceled（キャンセル）
 *    - サブスクリプション状態更新（status: 'canceled'）
 *    - キャンセル日時記録
 *
 * 4. refund.created（返金）
 *    - 返金記録（サブスク管理内で実施）
 *    - プラン適用即座終了
 *    - デフォルトプランへの遷移
 *
 * エラーハンドリング:
 * - イベント処理失敗時はEventBridgeのDLQへ（Lambda関数からエラーをthrow）
 * - 最大リトライ回数3回、指数バックオフ（EventBridge側で制御される）
 */

import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { FlowOrchestrator } from '../services/flowOrchestrator';
import {
  WebhookEventFlowInput,
  WebhookEventType,
  StripeEventData,
  AppleEventData,
  GoogleEventData,
} from '../types/eventTypes';
import { StepConfig } from '../types/stepTypes';
import { PlanManagementClient } from '../clients/planManagementClient';
import {
  SubscriptionManagementClient,
  UpdateSubscriptionStatusParams,
  ExtendSubscriptionPeriodParams,
} from '../clients/subscriptionManagementClient';
import { PlatformType, PurchaseFlowInput, PurchaseFlowOutput } from '../types/flowTypes';
import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import { Plan, UserPlanApplication } from '../../data-access/repositories/types';

// Lambda client instance
const lambdaClient = new LambdaClient({});

/**
 * デフォルトプランを取得
 * データベースからis_default=trueのプランを取得する
 *
 * @param tenantId テナントID
 * @returns デフォルトプランのID
 * @throws エラー（デフォルトプランが設定されていない場合）
 */
async function getDefaultPlanId(tenantId: string): Promise<string> {
  console.log('Getting default plan from database', { tenantId });

  try {
    const defaultPlan = await invokeDataAccessFunctionByTenantId<Plan | null>(
      tenantId,
      'plan',
      'getDefaultPlan',
      {}
    );

    if (!defaultPlan) {
      throw new Error('Default plan is not configured. Please configure a default plan in the system.');
    }

    console.log('Default plan found', {
      planId: defaultPlan.plan_id,
      internalName: defaultPlan.internal_name
    });

    return defaultPlan.plan_id;
  } catch (error) {
    console.error('Failed to get default plan', { tenantId, error });
    throw error;
  }
}

/**
 * Webhookイベント処理フローの出力結果
 */
interface WebhookEventFlowOutput {
  /** 成功フラグ */
  success: boolean;
  /** フロー実行ID */
  flowExecutionId: string;
  /** 処理されたイベントID */
  eventId: string;
  /** エラー詳細（失敗時） */
  errorDetails?: {
    errorCode?: string;
    errorMessage: string;
  };
}

/**
 * EventBridgeイベントのdetailペイロード
 * Payment Gatewayから送信されるEventDetail形式
 */
interface EventDetailPayload {
  eventId: string;
  tenantId: string;
  platform: PlatformType;
  eventData: Record<string, unknown>;
}

/**
 * EventBridgeイベント構造
 * EventBridgeから渡されるイベント全体を表す型
 */
interface EventBridgeEvent {
  /** イベントソース（例: "billing.payment-gateway"） */
  source: string;
  /** イベント詳細タイプ（ビジネスイベントタイプ: "payment_method.updated" など） */
  'detail-type': string;
  /** イベントペイロード（EventDetail形式） */
  detail: EventDetailPayload;
}

/**
 * Webhook Event Flow Lambda Handler
 *
 * EventBridgeから呼び出されます。イベントタイプに応じて異なる処理フローを実行します。
 *
 * @param event EventBridgeイベント
 * @returns Webhookイベント処理フロー実行結果
 */
export const handler = async (
  event: EventBridgeEvent
): Promise<WebhookEventFlowOutput> => {
  // EventBridgeイベントからdetailを抽出
  // Note: event['detail-type'] contains the business event type (e.g., 'payment_method.updated')
  //       event.detail contains the EventDetail object with originalEventType
  const input = event.detail;
  const { eventId, tenantId, platform, eventData } = input;
  // Use detail-type as the business event type (already normalized by eventMapper)
  const businessEventType = event['detail-type'];

  console.log('Webhook event flow started', {
    eventId,
    tenantId,
    platform,
    businessEventType,
  });

  // クライアントのインスタンス化
  const orchestrator = new FlowOrchestrator(tenantId);
  const planClient = new PlanManagementClient();
  const subscriptionClient = new SubscriptionManagementClient();

  // イベントタイプごとに処理を分岐
  try {
    // EventBridgeのdetail-typeは既にビジネスイベントタイプに正規化されている
    // Stripeの場合: eventMapperで checkout.session.completed → payment_method.updated に変換済み
    const normalizedEventType = normalizeEventType(platform, businessEventType as WebhookEventType);

    console.log('Normalized event type', {
      businessEventType,
      normalizedEventType,
      platform,
    });

    // 正規化されたイベントタイプに応じて処理
    switch (normalizedEventType) {
      case 'payment.succeeded':
        return await handlePaymentSucceeded(
          input,
          orchestrator,
          planClient,
          subscriptionClient
        );

      case 'payment.failed':
        return await handlePaymentFailed(
          input,
          orchestrator,
          subscriptionClient
        );

      case 'subscription.canceled':
        return await handleSubscriptionCanceled(
          input,
          orchestrator,
          subscriptionClient
        );

      case 'refund.created':
      case 'payment.refunded':
        return await handleRefundCreated(
          input,
          orchestrator,
          planClient,
          subscriptionClient
        );

      case 'payment_method.updated':
        return await handlePaymentMethodUpdated(
          input,
          orchestrator,
          tenantId
        );

      case 'subscription.parental_activated':
        return await handleParentalControlActivation(
          input,
          orchestrator,
          tenantId
        );

      case 'subscription.updated':
        return await handleSubscriptionUpdated(
          input,
          orchestrator,
          planClient,
          tenantId
        );

      default:
        console.warn('Unknown event type, skipping processing', {
          businessEventType,
          normalizedEventType,
          platform,
        });

        // 不明なイベントタイプはログ出力してスキップ（エラーにしない）
        return {
          success: true,
          flowExecutionId: '',
          eventId,
          errorDetails: {
            errorCode: 'UNKNOWN_EVENT_TYPE',
            errorMessage: `Unknown event type: ${businessEventType}`,
          },
        };
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error('Webhook event flow execution failed', {
      eventId,
      tenantId,
      platform,
      businessEventType,
      error: err.message,
      stack: err.stack,
    });

    // EventBridgeのDLQに送信するため、エラーをスロー
    throw new Error(
      `Webhook event processing failed: ${err.message}`,
      { cause: err }
    );
  }
};

/**
 * 正規化されたイベントタイプ
 */
type NormalizedEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.canceled'
  | 'subscription.updated'
  | 'refund.created'
  | 'payment.refunded'
  | 'payment_method.updated'
  | 'subscription.parental_activated'
  | 'unknown';

/**
 * イベントタイプを正規化
 *
 * プラットフォーム固有のイベント名を共通イベント名にマッピングします。
 *
 * @param platform 決済プラットフォーム
 * @param eventType イベントタイプ
 * @returns 正規化されたイベントタイプ
 */
function normalizeEventType(
  platform: PlatformType,
  eventType: WebhookEventType
): NormalizedEventType {
  // Stripeのイベントはそのまま使用
  if (platform === 'stripe') {
    return eventType as NormalizedEventType;
  }

  // Appleのイベントをマッピング
  if (platform === 'apple') {
    switch (eventType) {
      case 'RENEWAL':
        return 'payment.succeeded';
      case 'DID_FAIL_TO_RENEW':
        return 'payment.failed';
      case 'DID_CHANGE_RENEWAL_STATUS':
        return 'subscription.canceled';
      case 'REFUND':
        return 'refund.created';
      default:
        return 'unknown';
    }
  }

  // Googleのイベントをマッピング
  if (platform === 'google') {
    switch (eventType) {
      case 'SUBSCRIPTION_RENEWED':
        return 'payment.succeeded';
      case 'SUBSCRIPTION_EXPIRED':
        return 'payment.failed';
      case 'SUBSCRIPTION_CANCELED':
        return 'subscription.canceled';
      case 'SUBSCRIPTION_REFUNDED':
        return 'refund.created';
      default:
        return 'unknown';
    }
  }

  return 'unknown';
}

/**
 * payment.succeeded（更新成功）イベントを処理
 *
 * 処理ステップ:
 * 1. サブスクリプション有効期限延長
 * 2. プラン適用有効期限延長（scheduled_terminationの場合はスキップ）
 * 3. 支払い履歴記録（サブスク管理内で実施）
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @returns 処理結果
 */
async function handlePaymentSucceeded(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient
): Promise<WebhookEventFlowOutput> {
  const { eventId, tenantId, platform, eventData } = input;

  console.log('Processing payment.succeeded event', { eventId, tenantId, platform });

  // イベントデータから必要な情報を抽出
  const subscriptionId = extractSubscriptionId(platform, eventData);
  const newExpiresAt = extractExpirationDate(platform, eventData);
  const userId = extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション有効期限延長
    {
      stepName: 'extend_subscription_period',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Extending subscription period', {
          tenantId,
          subscriptionId,
          newExpiresAt,
        });

        const params: ExtendSubscriptionPeriodParams = {
          tenantId,
          subscriptionId,
          newExpiresAt,
        };

        const result = await subscriptionClient.extendSubscriptionPeriod(params);

        console.log('Subscription period extended successfully', {
          subscriptionId,
          success: result.success,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: プラン適用有効期限延長（scheduled_terminationの場合はスキップ）
    {
      stepName: 'extend_plan_application_period',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Checking plan application status', {
          tenantId,
          userId,
          subscriptionId,
        });

        // サブスクリプションIDをapplication_source_idとして、プラン適用を検索
        const planApplication = await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
          tenantId,
          'user-plan-application',
          'findByApplicationSourceId',
          { sourceId: subscriptionId }
        );

        if (!planApplication) {
          console.warn('No plan application found for subscription, skipping', {
            subscriptionId,
          });
          return {
            skipped: true,
            reason: 'no_plan_application_found',
          };
        }

        const planApplicationId = planApplication.application_id;
        const isScheduledTermination = planApplication.application_status === 'scheduled_termination';

        // ステータスがscheduled_terminationの場合はスキップ（解約予約済みなので延長しない）
        if (isScheduledTermination) {
          console.log('Skipping plan application period extension (scheduled_termination)', {
            planApplicationId,
            currentStatus: planApplication.application_status,
          });
          return {
            skipped: true,
            reason: 'scheduled_termination',
          };
        }

        // プラン適用の有効期限を延長（activeステータスを維持）
        const result = await planClient.updatePlanApplicationStatus({
          tenantId,
          applicationId: planApplicationId,
          newStatus: 'active',
        });

        console.log('Plan application period extended successfully', {
          planApplicationId,
          success: result.success,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: 支払い履歴記録（サブスク管理内で実施）
    // 支払い履歴の記録はSubscriptionManagementClient.extendSubscriptionPeriod()内で
    // 自動的に実施される想定のため、統括責務では明示的なステップとしては実装しない
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * payment.failed（支払い失敗）イベントを処理
 *
 * 処理ステップ:
 * 1. サブスクリプション状態更新（status: 'past_due'）
 * 2. 支払い失敗履歴記録
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param subscriptionClient サブスクリプション管理クライアント
 * @returns 処理結果
 */
async function handlePaymentFailed(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  subscriptionClient: SubscriptionManagementClient
): Promise<WebhookEventFlowOutput> {
  const { eventId, tenantId, platform, eventData } = input;

  console.log('Processing payment.failed event', { eventId, tenantId, platform });

  // イベントデータから必要な情報を抽出
  const subscriptionId = extractSubscriptionId(platform, eventData);
  const userId = extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション状態更新（status: 'past_due'）
    {
      stepName: 'update_subscription_to_past_due',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating subscription status to past_due', {
          tenantId,
          subscriptionId,
        });

        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId,
          newStatus: 'past_due',
        };

        const result = await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Subscription status updated to past_due', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: 支払い失敗履歴記録
    // 支払い失敗の履歴記録はSubscriptionManagementClient.updateSubscriptionStatus()内で
    // 自動的に実施される想定のため、統括責務では明示的なステップとしては実装しない

    // ステップ3: 通知送信（将来実装）
    // {
    //   stepName: 'send_payment_failed_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending payment failed notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * subscription.canceled（キャンセル）イベントを処理
 *
 * 処理ステップ:
 * 1. サブスクリプション状態更新（status: 'canceled'）
 * 2. キャンセル日時記録
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param subscriptionClient サブスクリプション管理クライアント
 * @returns 処理結果
 */
async function handleSubscriptionCanceled(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  subscriptionClient: SubscriptionManagementClient
): Promise<WebhookEventFlowOutput> {
  const { eventId, tenantId, platform, eventData } = input;

  console.log('Processing subscription.canceled event', { eventId, tenantId, platform });

  // イベントデータから必要な情報を抽出
  const subscriptionId = extractSubscriptionId(platform, eventData);
  const userId = extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション状態更新（status: 'canceled'）
    {
      stepName: 'update_subscription_to_canceled',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Updating subscription status to canceled', {
          tenantId,
          subscriptionId,
        });

        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId,
          newStatus: 'canceled',
        };

        const result = await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Subscription status updated to canceled', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: キャンセル日時記録
    // キャンセル日時の記録はSubscriptionManagementClient.updateSubscriptionStatus()内で
    // canceledAt属性に記録される想定のため、統括責務では明示的なステップとしては実装しない

    // ステップ3: 通知送信（将来実装）
    // {
    //   stepName: 'send_subscription_canceled_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending subscription canceled notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * refund.created（返金）イベントを処理
 *
 * 処理ステップ:
 * 1. 返金記録（サブスク管理内で実施）
 * 2. プラン適用即座終了
 * 3. デフォルトプランへの遷移
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @returns 処理結果
 */
async function handleRefundCreated(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient
): Promise<WebhookEventFlowOutput> {
  const { eventId, tenantId, platform, eventData } = input;

  console.log('Processing refund.created event', { eventId, tenantId, platform });

  // イベントデータから必要な情報を抽出
  const subscriptionId = extractSubscriptionId(platform, eventData);
  const userId = extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: 返金記録（サブスク管理内で実施）
    // 返金の記録はSubscriptionManagement側で別のInternal関数として実装される想定
    // ここでは、サブスクリプションステータスを更新して返金を記録する
    {
      stepName: 'record_refund',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction: process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Recording refund', {
          tenantId,
          subscriptionId,
        });

        // 返金時はサブスクリプションをcanceledステータスに更新
        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId,
          newStatus: 'canceled',
        };

        const result = await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Refund recorded successfully', {
          subscriptionId,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: プラン適用即座終了
    {
      stepName: 'terminate_plan_application_immediately',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        console.log('Terminating plan application immediately (refund)', {
          tenantId,
          userId,
        });

        // subscriptionIdをapplicationSourceIdとして渡し、Lambda側で適用を検索して終了
        const result = await planClient.terminatePlanApplication({
          tenantId,
          userId,
          applicationSourceId: subscriptionId,
        });

        console.log('Plan application terminated immediately', {
          applicationId: result.applicationId,
          success: result.success,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: デフォルトプランへの遷移
    {
      stepName: 'apply_default_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        // データベースからデフォルトプランを取得
        const defaultPlanId = await getDefaultPlanId(tenantId);

        console.log('Applying default plan to user (refund)', {
          tenantId,
          userId,
          planId: defaultPlanId,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId,
          planId: defaultPlanId,
          applicationSource: 'default',
          applicationSourceId: undefined,
          validFrom: new Date().toISOString(),
          // validUntilは指定しない（無期限の無料プラン）
        });

        console.log('Default plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: 通知送信（将来実装）
    // {
    //   stepName: 'send_refund_notification',
    //   stepType: 'api_call',
    //   targetService: 'NotificationService',
    //   targetFunction: process.env.NOTIFICATION_SERVICE_SEND_FUNCTION_NAME,
    //   executeFunction: async () => {
    //     console.log('Sending refund notification', { tenantId, userId });
    //
    //     // TODO: NotificationServiceClientを実装後、通知送信処理を追加
    //     return { notificationId: 'notification-placeholder' };
    //   },
    //   retryable: true,
    //   maxRetries: 3,
    // },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * Webhookイベントフローを実行
 *
 * @param orchestrator フローオーケストレーター
 * @param flowType フロータイプ
 * @param userId ユーザID
 * @param initiatedBy 開始者
 * @param inputParameters 入力パラメータ
 * @param steps ステップ設定
 * @param eventId イベントID
 * @returns フロー実行結果
 */
async function executeWebhookEventFlow(
  orchestrator: FlowOrchestrator,
  flowType: 'webhook_event',
  userId: string,
  initiatedBy: string,
  inputParameters: Record<string, unknown>,
  steps: StepConfig[],
  eventId: string
): Promise<WebhookEventFlowOutput> {
  let flowExecutionId = '';
  const previousStepResults: Record<string, unknown> = {};

  try {
    flowExecutionId = await orchestrator.startFlow(
      flowType,
      userId,
      initiatedBy,
      inputParameters,
      steps.length
    );

    console.log('Webhook event flow execution started', { flowExecutionId, eventId });

    // 各ステップを順次実行
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      console.log(`Executing step ${i + 1}/${steps.length}: ${step.stepName}`);

      const result = await orchestrator.executeStep(
        flowExecutionId,
        i,
        step,
        { previousStepResults }
      );

      if (!result.success) {
        console.error(`Step ${step.stepName} failed`);
        throw new Error(`Step ${step.stepName} failed`);
      }

      // 次のステップ用に結果を保存
      previousStepResults[step.stepName] = result.outputData;

      console.log(`Step ${step.stepName} completed successfully`);
    }

    // フロー完了
    const output: WebhookEventFlowOutput = {
      success: true,
      flowExecutionId,
      eventId,
    };

    await orchestrator.completeFlow(flowExecutionId, output as unknown as Record<string, unknown>);

    console.log('Webhook event flow completed successfully', {
      flowExecutionId,
      eventId,
    });

    return output;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    console.error('Webhook event flow execution failed', {
      flowExecutionId,
      eventId,
      error: err.message,
      stack: err.stack,
    });

    // フロー失敗を記録
    if (flowExecutionId) {
      await orchestrator.failFlow(flowExecutionId, {
        errorCode: 'WEBHOOK_EVENT_FLOW_ERROR',
        errorMessage: err.message,
        stackTrace: err.stack,
      });
    }

    // エラーレスポンスを返す（EventBridgeのDLQに送信するため、エラーをスロー）
    throw new Error(
      `Webhook event flow failed: ${err.message}`,
      { cause: err }
    );
  }
}

/**
 * イベントデータからサブスクリプションIDを抽出
 *
 * @param platform 決済プラットフォーム
 * @param eventData イベントデータ
 * @returns サブスクリプションID
 */
function extractSubscriptionId(
  platform: PlatformType,
  eventData: Record<string, unknown>
): string {
  if (platform === 'stripe') {
    const stripeData = eventData as StripeEventData;
    return stripeData.subscriptionId || '';
  }

  if (platform === 'apple') {
    const appleData = eventData as AppleEventData;
    return appleData.originalTransactionId || '';
  }

  if (platform === 'google') {
    const googleData = eventData as GoogleEventData;
    return googleData.subscriptionId || '';
  }

  return '';
}

/**
 * イベントデータから有効期限を抽出
 *
 * @param platform 決済プラットフォーム
 * @param eventData イベントデータ
 * @returns 有効期限（ISO 8601形式）
 */
function extractExpirationDate(
  platform: PlatformType,
  eventData: Record<string, unknown>
): string {
  if (platform === 'stripe') {
    const stripeData = eventData as StripeEventData;
    if (stripeData.periodEnd) {
      // StripeはUnixタイムスタンプ（秒）なので、ミリ秒に変換してISO 8601形式にする
      return new Date(stripeData.periodEnd * 1000).toISOString();
    }
  }

  if (platform === 'apple') {
    const appleData = eventData as AppleEventData;
    if (appleData.expiresDate) {
      // AppleはUnixタイムスタンプ（ミリ秒）なので、そのままISO 8601形式にする
      return new Date(appleData.expiresDate).toISOString();
    }
  }

  if (platform === 'google') {
    const googleData = eventData as GoogleEventData;
    if (googleData.expiryTimeMillis) {
      // GoogleはUnixタイムスタンプ（ミリ秒）なので、そのままISO 8601形式にする
      return new Date(googleData.expiryTimeMillis).toISOString();
    }
  }

  // デフォルト: 30日後
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 30);
  return defaultDate.toISOString();
}

/**
 * イベントデータからユーザIDを抽出
 *
 * @param platform 決済プラットフォーム
 * @param eventData イベントデータ
 * @returns ユーザID（取得できない場合はundefined）
 */
function extractUserId(
  platform: PlatformType,
  eventData: Record<string, unknown>
): string | undefined {
  // TODO: 実際の実装では、サブスクリプションIDからユーザIDを取得する処理を実装
  // 現時点では、イベントデータに含まれるユーザIDを返す（将来的にはSubscriptionManagementClientで取得）

  if (platform === 'stripe') {
    const stripeData = eventData as StripeEventData;
    // StripeのcustomerIdはユーザIDではないため、実際にはマッピングが必要
    // 仮実装としてcustomerIdを返す
    return stripeData.customerId;
  }

  // Apple/Googleの場合は、イベントデータからユーザIDを直接取得できない
  // サブスクリプション情報から取得する必要がある
  return undefined;
}

/**
 * Stripe APIキーのキャッシュ
 */
const stripeApiKeyCache: Record<string, string> = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 * コントロールプレーン（genu account）のSecrets Managerから取得
 * テナント固有のシークレット名: {tenantId}/billing/stripe
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;

  try {
    // コントロールプレーンのSecrets Managerから取得（receiveWebhookと同じ方式）
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
    const command = new GetSecretValueCommand({ SecretId: secretName });
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
 * payment_method.updated（支払い方法更新）イベントを処理
 *
 * 処理ステップ:
 * 1. SetupIntentから新しい支払い方法IDを取得
 * 2. サブスクリプションのdefault_payment_methodを更新
 * 3. 顧客のinvoice_settings.default_payment_methodを更新（オプション）
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param tenantId テナントID
 * @returns 処理結果
 */
async function handlePaymentMethodUpdated(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  tenantId: string
): Promise<WebhookEventFlowOutput> {
  const { eventId, platform, eventData } = input;
  const userId = extractUserId(platform, eventData);

  console.log('Processing payment_method.updated event', { eventId, tenantId, platform });

  // イベントデータから抽出情報を取得（Stripeプラットフォームのみ対応）
  const stripeData: StripeEventData = eventData;
  const extracted = stripeData._extracted ?? {};
  const { setupIntentId, platformSubscriptionId, customerId } = extracted;

  console.log('Extracted data from event', {
    setupIntentId,
    platformSubscriptionId,
    customerId,
    hasExtracted: !!stripeData._extracted,
    eventDataKeys: Object.keys(eventData),
  });

  if (!setupIntentId) {
    throw new Error('SetupIntent ID not found in event data');
  }

  if (!platformSubscriptionId) {
    throw new Error('Platform subscription ID not found in event data');
  }

  // ステップ設定
  const steps: StepConfig[] = [
    {
      stepName: 'update_subscription_payment_method',
      stepType: 'api_call',
      targetService: 'Stripe',
      executeFunction: async () => {
        console.log('Updating subscription payment method', {
          tenantId,
          platformSubscriptionId,
          setupIntentId,
        });

        // Stripe APIキーを取得
        const apiKey = await getStripeApiKey(tenantId);
        const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

        // SetupIntentから支払い方法IDを取得
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
        const newPaymentMethodId =
          typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method
            : setupIntent.payment_method?.id;

        if (!newPaymentMethodId) {
          throw new Error('Payment method not found on SetupIntent');
        }

        console.log('Retrieved payment method from SetupIntent', {
          setupIntentId,
          newPaymentMethodId,
        });

        // サブスクリプションのdefault_payment_methodを更新
        await stripe.subscriptions.update(platformSubscriptionId, {
          default_payment_method: newPaymentMethodId,
        });

        console.log('Subscription payment method updated', {
          platformSubscriptionId,
          newPaymentMethodId,
        });

        // 顧客のinvoice_settings.default_payment_methodも更新（オプション）
        if (customerId) {
          await stripe.customers.update(customerId, {
            invoice_settings: {
              default_payment_method: newPaymentMethodId,
            },
          });

          console.log('Customer invoice settings updated', {
            customerId,
            newPaymentMethodId,
          });
        }

        return {
          success: true,
          newPaymentMethodId,
          platformSubscriptionId,
        };
      },
      retryable: true,
      maxRetries: 3,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * subscription.parental_activated（ペアレンタルコントロールによるサブスクリプション有効化）イベントを処理
 *
 * 処理ステップ:
 * 1. purchaseFlowを呼び出してサブスクリプションを有効化
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param tenantId テナントID
 * @returns 処理結果
 */
async function handleParentalControlActivation(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  tenantId: string
): Promise<WebhookEventFlowOutput> {
  const { eventId, platform, eventData } = input;

  console.log('Processing subscription.parental_activated event', { eventId, tenantId, platform });

  // イベントデータから抽出情報を取得
  const stripeData = eventData as StripeEventData;
  const extracted = stripeData._extracted ?? {};
  const { sessionId, platformSubscriptionId, userId, planId, childEmail } = extracted;

  console.log('Extracted parental control data from event', {
    sessionId,
    platformSubscriptionId,
    userId,
    planId,
    childEmail,
    hasExtracted: !!stripeData._extracted,
  });

  if (!sessionId) {
    throw new Error('Session ID not found in event data');
  }

  if (!platformSubscriptionId) {
    throw new Error('Platform subscription ID not found in event data');
  }

  if (!userId) {
    throw new Error('User ID not found in event data');
  }

  if (!planId) {
    throw new Error('Plan ID not found in event data');
  }

  // ステップ設定
  const steps: StepConfig[] = [
    {
      stepName: 'activate_parental_control_subscription',
      stepType: 'api_call',
      targetService: 'PurchaseFlow',
      executeFunction: async () => {
        console.log('Invoking purchase flow for parental control activation', {
          tenantId,
          userId,
          planId,
          sessionId,
          platformSubscriptionId,
        });

        // purchaseFlowを呼び出す
        const purchaseFlowFunctionName = process.env.PURCHASE_FLOW_FUNCTION_NAME;

        if (!purchaseFlowFunctionName) {
          throw new Error('PURCHASE_FLOW_FUNCTION_NAME is not configured');
        }

        const flowInput: PurchaseFlowInput = {
          tenantId,
          userId: userId as string,
          planId: planId as string,
          paymentPlatform: 'stripe',
          receiptData: {
            sessionId: sessionId as string,
            subscriptionId: platformSubscriptionId as string,
          },
        };

        console.log('Invoking purchase flow:', {
          functionName: purchaseFlowFunctionName,
          input: { ...flowInput, receiptData: '[REDACTED]' },
        });

        const invokeCommand = new InvokeCommand({
          FunctionName: purchaseFlowFunctionName,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify(flowInput),
        });

        const invokeResult = await lambdaClient.send(invokeCommand);

        if (invokeResult.FunctionError) {
          console.error('Purchase flow function error:', {
            functionError: invokeResult.FunctionError,
            payload: invokeResult.Payload
              ? new TextDecoder().decode(invokeResult.Payload)
              : null,
          });

          throw new Error(`Purchase flow failed: ${invokeResult.FunctionError}`);
        }

        if (!invokeResult.Payload) {
          throw new Error('Purchase flow returned no payload');
        }

        const flowOutput: PurchaseFlowOutput = JSON.parse(
          new TextDecoder().decode(invokeResult.Payload)
        );

        console.log('Purchase flow completed:', {
          success: flowOutput.success,
          flowExecutionId: flowOutput.flowExecutionId,
          subscriptionId: flowOutput.subscriptionId,
        });

        if (!flowOutput.success) {
          throw new Error(
            flowOutput.errorDetails?.errorMessage ||
            'Purchase flow failed'
          );
        }

        return {
          success: true,
          subscriptionId: flowOutput.subscriptionId,
          flowExecutionId: flowOutput.flowExecutionId,
        };
      },
      retryable: true,
      maxRetries: 3,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId as string || 'unknown',
    `${platform}_parental_control_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * subscription.updated（サブスクリプション更新/プラン変更）イベントを処理
 *
 * Customer Portalからのプラン変更時に呼び出されます。
 *
 * 処理ステップ:
 * 1. Price IDから内部プランIDを取得
 * 2. 古いプラン適用を終了
 * 3. 新しいプランを適用
 * 4. pending-plan-changeのステータスを更新（存在する場合）
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param tenantId テナントID
 * @returns 処理結果
 */
async function handleSubscriptionUpdated(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  tenantId: string
): Promise<WebhookEventFlowOutput> {
  const { eventId, platform, eventData } = input;

  console.log('Processing subscription.updated event', { eventId, tenantId, platform });

  // イベントデータから必要な情報を抽出
  const stripeData = eventData as StripeEventData;
  const platformSubscriptionId = stripeData.platformSubscriptionId || stripeData.subscriptionId || '';
  const newPriceId = stripeData.newPriceId;
  const previousPriceId = stripeData.previousPriceId;
  const userId = stripeData.userId;

  console.log('Subscription update data', {
    platformSubscriptionId,
    newPriceId,
    previousPriceId,
    userId,
  });

  if (!newPriceId) {
    throw new Error('New price ID not found in subscription.updated event');
  }

  if (!platformSubscriptionId) {
    throw new Error('Platform subscription ID not found in subscription.updated event');
  }

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: Price IDから内部プランIDを取得し、プラン変更を実行
    {
      stepName: 'update_plan_application',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      executeFunction: async () => {
        console.log('Looking up plan by platform product ID (new price)', {
          tenantId,
          newPriceId,
        });

        // 新しいPrice IDから内部プランを検索
        const newPlan = await invokeDataAccessFunctionByTenantId<Plan | null>(
          tenantId,
          'plan',
          'findByPlatformProductId',
          { platformProductId: newPriceId }
        );

        if (!newPlan) {
          throw new Error(`Plan not found for platform product ID: ${newPriceId}`);
        }

        console.log('Found new plan', {
          planId: newPlan.plan_id,
          internalName: newPlan.internal_name,
        });

        // platformSubscriptionIdから内部サブスクリプションを検索
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
          user_id: string;
        } | null>(
          tenantId,
          'subscription',
          'findByPlatformSubscriptionId',
          { platformSubscriptionId }
        );

        if (!subscription) {
          throw new Error(`Subscription not found for platform subscription ID: ${platformSubscriptionId}`);
        }

        const subscriptionId = subscription.subscription_id;
        const effectiveUserId = userId || subscription.user_id;

        console.log('Found subscription', {
          subscriptionId,
          userId: effectiveUserId,
        });

        // 古いプラン適用を終了
        console.log('Terminating old plan application', {
          tenantId,
          userId: effectiveUserId,
          subscriptionId,
        });

        const terminateResult = await planClient.terminatePlanApplication({
          tenantId,
          userId: effectiveUserId,
          applicationSourceId: subscriptionId,
        });

        console.log('Old plan application terminated', {
          success: terminateResult.success,
          applicationId: terminateResult.applicationId,
        });

        // 新しいプランを適用
        console.log('Applying new plan', {
          tenantId,
          userId: effectiveUserId,
          planId: newPlan.plan_id,
          subscriptionId,
        });

        const applyResult = await planClient.applyPlanToUser({
          tenantId,
          userId: effectiveUserId,
          planId: newPlan.plan_id,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionId,
          validFrom: new Date().toISOString(),
        });

        console.log('New plan applied', {
          success: applyResult.success,
          applicationId: applyResult.applicationId,
          applicationStatus: applyResult.applicationStatus,
        });

        return {
          success: true,
          subscriptionId,
          userId: effectiveUserId,
          oldPlanTerminated: terminateResult.success,
          newPlanApplied: applyResult.success,
          newPlanId: newPlan.plan_id,
          newApplicationId: applyResult.applicationId,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: pending-plan-changeのステータスを更新（存在する場合）
    {
      stepName: 'update_pending_plan_change_status',
      stepType: 'api_call',
      targetService: 'DataAccess',
      executeFunction: async () => {
        console.log('Checking for pending plan change request', {
          tenantId,
          platformSubscriptionId,
        });

        // platformSubscriptionIdに紐づくpending-plan-changeを検索
        // 注意: 内部subscriptionIdを使用する必要がある
        try {
          // pending-plan-changeのステータスを更新
          const result = await invokeDataAccessFunctionByTenantId<{
            updated: boolean;
            requestId?: string;
          }>(
            tenantId,
            'pending-plan-change',
            'updateStatusByPlatformSubscriptionId',
            {
              platformSubscriptionId,
              newStatus: 'approved',
              approvedAt: new Date().toISOString(),
            }
          );

          console.log('Pending plan change status update result', result);

          return {
            success: true,
            pendingPlanChangeUpdated: result.updated,
            requestId: result.requestId,
          };
        } catch (error) {
          // pending-plan-changeが見つからない場合はスキップ（直接Customer Portalからの変更の可能性）
          console.warn('Failed to update pending plan change (may not exist)', { error });
          return {
            success: true,
            pendingPlanChangeUpdated: false,
            skipped: true,
            reason: 'pending_plan_change_not_found_or_error',
          };
        }
      },
      retryable: true,
      maxRetries: 3,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    userId || 'unknown',
    `${platform}_subscription_updated_webhook`,
    input,
    steps,
    eventId
  );
}
