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
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
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
import {
  PlatformType,
  PurchaseFlowInput,
  PurchaseFlowOutput,
} from '../types/flowTypes';
import { invokeDataAccessFunctionByTenantId } from '../../utils/dataAccessClient';
import {
  Plan,
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  sendPaymentReceipt,
  buildReceiptDataFromInvoice,
  getReceiptRecipient,
  getUserEmail,
  ReceiptData,
} from '../services/receiptEmailService';
import { IdempotencyRepository } from '../repositories/idempotencyRepository';

// Lambda client instance
const lambdaClient = new LambdaClient({});

// DynamoDB client instance
const dynamoDbClient = new DynamoDBClient({});

// ペアレンタルコントロール用プラン変更リクエストテーブル
const PENDING_PLAN_CHANGES_TABLE_NAME =
  process.env.PENDING_PLAN_CHANGES_TABLE_NAME || '';

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
      throw new Error(
        'Default plan is not configured. Please configure a default plan in the system.'
      );
    }

    console.log('Default plan found', {
      planId: defaultPlan.plan_id,
      internalName: defaultPlan.internal_name,
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
  /** ユーザーID（EventDetail.userIdから抽出） */
  userId?: string;
  /** 内部サブスクリプションID（EventDetail.subscriptionIdから抽出） */
  subscriptionId?: string;
  /** プラットフォームサブスクリプションID（Stripe等のサブスクリプションID） */
  platformSubscriptionId?: string;
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
    const normalizedEventType = normalizeEventType(
      platform,
      businessEventType as WebhookEventType
    );

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
          planClient,
          subscriptionClient
        );

      case 'subscription.updated':
        return await handleSubscriptionUpdated(
          input,
          orchestrator,
          planClient,
          subscriptionClient,
          tenantId
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
        return await handlePaymentMethodUpdated(input, orchestrator, tenantId);

      case 'subscription.parental_activated':
        return await handleParentalControlActivation(
          input,
          orchestrator,
          tenantId
        );

      case 'subscription.plan_change_completed':
        return await handlePlanChangeCompleted(
          input,
          orchestrator,
          planClient,
          subscriptionClient,
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
    throw new Error(`Webhook event processing failed: ${err.message}`, {
      cause: err,
    });
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
  | 'subscription.plan_change_completed'
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

  console.log('Processing payment.succeeded event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから必要な情報を抽出
  // subscriptionIdはプラットフォームのサブスクリプションID（Stripeのsub_xxx形式）
  const platformSubscriptionId =
    input.subscriptionId || extractSubscriptionId(platform, eventData);
  const userId = input.userId || extractUserId(platform, eventData);

  // periodStart/periodEndの抽出（Stripeから取得）
  const { periodStart, periodEnd } = extractPeriodDates(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション有効期限延長
    {
      stepName: 'extend_subscription_period',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME,
      executeFunction: async () => {
        // プラットフォームサブスクリプションIDから内部サブスクリプションIDを取得
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
          user_id: string;
        } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
          platformSubscriptionId,
        });

        if (!subscription) {
          console.warn(
            'No internal subscription found for platform subscription',
            {
              platformSubscriptionId,
            }
          );
          return {
            skipped: true,
            reason: 'no_internal_subscription_found',
          };
        }

        const internalSubscriptionId = subscription.subscription_id;

        console.log('Extending subscription period', {
          tenantId,
          platformSubscriptionId,
          internalSubscriptionId,
          periodStart,
          periodEnd,
        });

        const params: ExtendSubscriptionPeriodParams = {
          tenantId,
          subscriptionId: internalSubscriptionId,
          newPeriodStart: periodStart,
          newPeriodEnd: periodEnd,
        };

        const result =
          await subscriptionClient.extendSubscriptionPeriod(params);

        console.log('Subscription period extended successfully', {
          internalSubscriptionId,
          success: result.success,
        });

        // 次のステップで使用するために保存
        previousStepResults['internal_subscription'] = {
          subscriptionId: internalSubscriptionId,
          userId: subscription.user_id,
        };

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
        // 前のステップから内部サブスクリプションIDを取得
        const internalSubscription = previousStepResults[
          'internal_subscription'
        ] as
          | {
              subscriptionId: string;
              userId: string;
            }
          | undefined;

        if (!internalSubscription) {
          console.warn(
            'No internal subscription from previous step, skipping plan application extension'
          );
          return {
            skipped: true,
            reason: 'no_internal_subscription_from_previous_step',
          };
        }

        const internalSubscriptionId = internalSubscription.subscriptionId;

        console.log('Checking plan application status', {
          tenantId,
          userId,
          internalSubscriptionId,
        });

        // 内部サブスクリプションIDをapplication_source_idとして、プラン適用を検索
        const planApplication =
          await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
            tenantId,
            'user-plan-application',
            'findByApplicationSourceId',
            { sourceId: internalSubscriptionId }
          );

        if (!planApplication) {
          console.warn('No plan application found for subscription, skipping', {
            internalSubscriptionId,
          });
          return {
            skipped: true,
            reason: 'no_plan_application_found',
          };
        }

        const planApplicationId = planApplication.application_id;
        const isScheduledTermination =
          planApplication.application_status === 'scheduled_termination';

        // ステータスがscheduled_terminationの場合はスキップ（解約予約済みなので延長しない）
        if (isScheduledTermination) {
          console.log(
            'Skipping plan application period extension (scheduled_termination)',
            {
              planApplicationId,
              currentStatus: planApplication.application_status,
            }
          );
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

    // ステップ4: 領収書メール送信（非ブロッキング）
    {
      stepName: 'send_payment_receipt',
      stepType: 'api_call',
      targetService: 'EmailService',
      executeFunction: async () => {
        try {
          console.log('Sending payment receipt email', {
            tenantId,
            userId,
            platformSubscriptionId,
          });

          // Stripe APIキーを取得
          const apiKey = await getStripeApiKey(tenantId);
          const stripe = new Stripe(apiKey, {
            apiVersion: '2025-10-29.clover',
          });

          // invoiceIdを抽出（StripeのeventDataから）
          // eventDataはStripeの生イベントオブジェクト（stripeEvent）
          // invoice.payment_succeededの場合、data.objectがinvoiceオブジェクト
          const stripeData = eventData as StripeEventData;
          const invoiceObject = (stripeData as any).data?.object;
          const rawInvoiceId = invoiceObject?.id;

          if (!rawInvoiceId || typeof rawInvoiceId !== 'string') {
            console.warn(
              'Invoice ID not found in event data, skipping receipt',
              {
                eventId,
                hasDataObject: !!invoiceObject,
              }
            );
            return { success: true, emailSent: false, reason: 'no_invoice_id' };
          }

          const invoiceId: string = rawInvoiceId;

          // インボイス番号を取得（重複チェック用）
          const invoiceNumber = invoiceObject?.number as string | undefined;
          if (!invoiceNumber) {
            console.warn(
              'Invoice number not found in event data, skipping deduplication',
              {
                eventId,
                invoiceId,
              }
            );
          }

          // 冪等性チェック: 同一インボイスへの重複送信を防止
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );

            const alreadySent =
              await idempotencyRepo.isReceiptAlreadySent(idempotencyKey);
            if (alreadySent) {
              console.log('Receipt already sent for this invoice, skipping', {
                invoiceNumber,
                idempotencyKey,
              });
              return {
                success: true,
                emailSent: false,
                reason: 'already_sent',
              };
            }
          }

          // platformSubscriptionIdは関数スコープで既に定義済み
          if (!platformSubscriptionId) {
            console.warn(
              'Platform subscription ID not found, skipping receipt',
              { eventId }
            );
            return {
              success: true,
              emailSent: false,
              reason: 'no_subscription_id',
            };
          }

          // 領収書データを構築
          const receiptDataBase = await buildReceiptDataFromInvoice(
            stripe,
            invoiceId,
            tenantId,
            stripeData._extracted?.planId
          );

          // 送信先を決定（ペアレンタルコントロール対応）
          const userEmail = userId
            ? await getUserEmail(tenantId, userId)
            : null;
          const recipient = await getReceiptRecipient(
            stripe,
            platformSubscriptionId,
            userEmail || undefined
          );

          const receiptData: ReceiptData = {
            ...receiptDataBase,
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            childEmail: recipient.childEmail,
          };

          // 領収書メール送信
          await sendPaymentReceipt(receiptData);

          // 送信完了を記録
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );
            await idempotencyRepo.markReceiptSent(idempotencyKey);
          }

          console.log('Payment receipt email sent successfully', {
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            invoiceNumber,
          });

          return { success: true, emailSent: true };
        } catch (error) {
          // 領収書送信失敗はフローをブロックしない
          console.error('Failed to send payment receipt email', {
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: true,
            emailSent: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      retryable: false,
      maxRetries: 0,
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

  console.log('Processing payment.failed event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから必要な情報を抽出
  // subscriptionIdはEventDetailPayloadのトップレベルにある（eventExtractorで抽出済み）
  const subscriptionId =
    input.subscriptionId || extractSubscriptionId(platform, eventData);
  const userId = input.userId || extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション状態更新（status: 'past_due'）
    {
      stepName: 'update_subscription_to_past_due',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
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

        const result =
          await subscriptionClient.updateSubscriptionStatus(params);

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
 * 2. プラン適用終了
 * 3. デフォルトプランへの遷移
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @returns 処理結果
 */
async function handleSubscriptionCanceled(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient
): Promise<WebhookEventFlowOutput> {
  const {
    eventId,
    tenantId,
    platform,
    eventData,
    userId: eventUserId,
    subscriptionId,
    platformSubscriptionId: platformSubId,
  } = input;

  // platformSubscriptionIdを優先し、なければsubscriptionIdを使用
  const platformSubscriptionId = platformSubId || subscriptionId || '';

  console.log('Processing subscription.canceled event', {
    eventId,
    tenantId,
    platform,
    eventUserId,
    platformSubscriptionId,
    subscriptionId,
    platformSubId,
  });

  // Note: subscriptionIdとuserIdはEventDetailから直接取得（eventExtractorで抽出済み）
  // extractUserId()はStripe customerIdを返すため、eventUserIdを優先使用
  const userId = eventUserId || extractUserId(platform, eventData);

  // 前のステップの結果を保持する変数
  const previousStepResults: Record<string, unknown> = {};

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: サブスクリプション状態更新（status: 'canceled'）
    {
      stepName: 'update_subscription_to_canceled',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
      executeFunction: async () => {
        // platform_subscription_idから内部サブスクリプションIDを取得
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
          user_id: string;
        } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
          platformSubscriptionId,
        });

        if (!subscription) {
          console.warn(
            'No internal subscription found for platform subscription',
            {
              platformSubscriptionId,
              eventUserId: userId,
            }
          );
          // 内部サブスクリプションが見つからなくても、userIdがあれば
          // デフォルトプラン適用は可能なのでsubscription_infoを設定
          if (userId) {
            previousStepResults['subscription_info'] = {
              internalSubscriptionId: undefined,
              userId: userId,
            };
            console.log(
              'Using userId from event data for default plan application',
              { userId }
            );
            return {
              skipped: true,
              reason: 'no_internal_subscription_found',
              userId,
            };
          }
          return {
            skipped: true,
            reason: 'no_internal_subscription_found_and_no_user_id',
          };
        }

        console.log('Updating subscription status to canceled', {
          tenantId,
          subscriptionId: subscription.subscription_id,
        });

        const params: UpdateSubscriptionStatusParams = {
          tenantId,
          subscriptionId: subscription.subscription_id,
          newStatus: 'canceled',
        };

        const result =
          await subscriptionClient.updateSubscriptionStatus(params);

        console.log('Subscription status updated to canceled', {
          subscriptionId: subscription.subscription_id,
          previousStatus: result.previousStatus,
          newStatus: result.newStatus,
        });

        // 次のステップで使用するため、内部サブスクリプション情報を返す
        previousStepResults['subscription_info'] = {
          internalSubscriptionId: subscription.subscription_id,
          userId: subscription.user_id,
        };

        return {
          ...result,
          internalSubscriptionId: subscription.subscription_id,
          userId: subscription.user_id,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: プラン適用終了
    {
      stepName: 'terminate_plan_application',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        const subscriptionInfo = previousStepResults['subscription_info'] as
          | {
              internalSubscriptionId: string | undefined;
              userId: string;
            }
          | undefined;

        if (!subscriptionInfo) {
          console.log(
            'Skipping plan termination (no subscription info from previous step)'
          );
          return {
            skipped: true,
            reason: 'no_subscription_info',
          };
        }

        // 内部サブスクリプションIDがない場合はプラン終了をスキップ
        // （デフォルトプランへの遷移は次のステップで実行）
        if (!subscriptionInfo.internalSubscriptionId) {
          console.log(
            'Skipping plan termination (no internal subscription ID)',
            {
              userId: subscriptionInfo.userId,
            }
          );
          return {
            skipped: true,
            reason: 'no_internal_subscription_id',
          };
        }

        console.log('Terminating plan application', {
          tenantId,
          userId: subscriptionInfo.userId,
          applicationSourceId: subscriptionInfo.internalSubscriptionId,
        });

        try {
          const result = await planClient.terminatePlanApplication({
            tenantId,
            userId: subscriptionInfo.userId,
            applicationSourceId: subscriptionInfo.internalSubscriptionId,
          });

          console.log('Plan application terminated successfully', {
            applicationId: result.applicationId,
            success: result.success,
          });

          return result;
        } catch (error) {
          // プラン適用が見つからない場合（既に終了済みなど）はスキップ
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          if (
            errorMessage.includes('NO_ACTIVE_APPLICATION') ||
            errorMessage.includes('not found')
          ) {
            console.warn(
              'No active plan application found, skipping termination',
              {
                userId: subscriptionInfo.userId,
                applicationSourceId: subscriptionInfo.internalSubscriptionId,
              }
            );
            return {
              skipped: true,
              reason: 'no_active_application',
            };
          }
          throw error;
        }
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
        const subscriptionInfo = previousStepResults['subscription_info'] as
          | {
              internalSubscriptionId: string | undefined;
              userId: string;
            }
          | undefined;

        if (!subscriptionInfo || !subscriptionInfo.userId) {
          console.log(
            'Skipping default plan application (no subscription info or userId)'
          );
          return {
            skipped: true,
            reason: 'no_subscription_info_or_user_id',
          };
        }

        // データベースからデフォルトプランを取得
        const defaultPlanId = await getDefaultPlanId(tenantId);

        console.log('Applying default plan to user', {
          tenantId,
          userId: subscriptionInfo.userId,
          planId: defaultPlanId,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId: subscriptionInfo.userId,
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
 * subscription.updated（サブスクリプション更新）イベントを処理
 *
 * Customer Portalやsubscriptions.update APIによるプラン変更時に発火。
 * プラン変更があった場合、内部DBの状態を更新する。
 *
 * 処理ステップ:
 * 1. プラン変更かどうかを判定
 * 2. プラン変更の場合、現在のプラン適用を終了
 * 3. 新しいプランを適用
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @param tenantId テナントID
 * @returns 処理結果
 */
async function handleSubscriptionUpdated(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient,
  tenantId: string
): Promise<WebhookEventFlowOutput> {
  const { eventId, platform, eventData } = input;

  console.log('Processing subscription.updated event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから抽出情報を取得
  const stripeData = eventData as StripeEventData;
  const extracted = stripeData._extracted ?? {};
  const {
    subscriptionId: platformSubscriptionId,
    userId,
    currentPriceId,
    previousPriceId,
    isPlanChange,
    isParentalControlPlanChange,
  } = extracted;

  console.log('Extracted subscription update data', {
    platformSubscriptionId,
    userId,
    currentPriceId,
    previousPriceId,
    isPlanChange,
  });

  // プラン変更がない場合は処理をスキップ
  if (!isPlanChange) {
    console.log('No plan change detected, skipping processing', {
      eventId,
      platformSubscriptionId,
    });

    return {
      success: true,
      flowExecutionId: '',
      eventId,
      errorDetails: {
        errorCode: 'NO_PLAN_CHANGE',
        errorMessage: 'Subscription updated but no plan change detected',
      },
    };
  }

  if (!platformSubscriptionId) {
    throw new Error('Platform subscription ID not found in event data');
  }

  if (!userId) {
    throw new Error('User ID not found in event data');
  }

  if (!currentPriceId) {
    throw new Error('Current price ID not found in event data');
  }

  // 内部プランIDを解決するヘルパー
  const resolvePlanId = async (): Promise<string> => {
    console.log('Resolving plan ID from price ID', { currentPriceId });
    const plan = await invokeDataAccessFunctionByTenantId<{
      plan_id: string;
    } | null>(tenantId, 'plan', 'findByPlatformProductId', {
      platformProductId: currentPriceId,
    });
    if (plan?.plan_id) return plan.plan_id;

    throw new Error(
      `Could not resolve internal plan ID for price: ${currentPriceId}`
    );
  };

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: 現在のプラン適用を終了
    {
      stepName: 'terminate_current_plan_application',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        console.log(
          'Terminating current plan application (plan change via portal)',
          {
            tenantId,
            userId,
            platformSubscriptionId,
          }
        );

        // platform_subscription_idをapplicationSourceIdとして渡し、
        // Lambda側で適用を検索して終了
        // 注: 内部サブスクリプションIDを取得するためにまず検索が必要
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
        } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
          platformSubscriptionId,
        });

        if (!subscription) {
          console.warn(
            'No internal subscription found for platform subscription',
            {
              platformSubscriptionId,
            }
          );
          return {
            skipped: true,
            reason: 'no_internal_subscription_found',
          };
        }

        const result = await planClient.terminatePlanApplication({
          tenantId,
          userId: userId as string,
          applicationSourceId: subscription.subscription_id,
        });

        console.log('Plan application terminated successfully', {
          applicationId: result.applicationId,
          success: result.success,
        });

        return {
          ...result,
          internalSubscriptionId: subscription.subscription_id,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: サブスクリプションのプランIDを更新
    {
      stepName: 'update_subscription_plan',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      executeFunction: async () => {
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
        } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
          platformSubscriptionId,
        });

        if (!subscription) {
          console.warn('No internal subscription found, skipping plan update', {
            platformSubscriptionId,
          });
          return { skipped: true, reason: 'no_internal_subscription_found' };
        }

        const planId = await resolvePlanId();

        await invokeDataAccessFunctionByTenantId<{ subscription_id: string }>(
          tenantId,
          'subscription',
          'update',
          {
            subscriptionId: subscription.subscription_id,
            updates: { plan_id: planId },
          }
        );

        console.log('Subscription plan ID updated', {
          subscriptionId: subscription.subscription_id,
          planId,
        });

        return {
          success: true,
          internalSubscriptionId: subscription.subscription_id,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: 新しいプランを適用
    {
      stepName: 'apply_new_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        const subscription = await invokeDataAccessFunctionByTenantId<{
          subscription_id: string;
        } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
          platformSubscriptionId,
        });

        if (!subscription) {
          throw new Error(
            'Internal subscription not found for platform subscription'
          );
        }

        const planId = await resolvePlanId();

        console.log('Applying new plan to user (plan change via portal)', {
          tenantId,
          userId,
          planId,
          subscriptionId: subscription.subscription_id,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId: userId as string,
          planId,
          applicationSource: 'subscription',
          applicationSourceId: subscription.subscription_id,
          validFrom: new Date().toISOString(),
        });

        console.log('New plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: ペアレンタルコントロール用メタデータをクリーンアップ
    // プラン変更完了後、誤検出を防ぐためメタデータフラグを削除
    {
      stepName: 'cleanup_plan_change_metadata',
      stepType: 'api_call',
      targetService: 'Stripe',
      executeFunction: async () => {
        // ペアレンタルコントロールによるプラン変更の場合のみクリーンアップ
        if (!isParentalControlPlanChange) {
          console.log(
            'Not a parental control plan change, skipping metadata cleanup'
          );
          return { skipped: true, reason: 'not_parental_control_flow' };
        }

        console.log('Cleaning up parental control plan change metadata', {
          tenantId,
          platformSubscriptionId,
        });

        const apiKey = await getStripeApiKey(tenantId);
        const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

        // メタデータのプラン変更関連フラグを削除（空文字列で削除）
        await stripe.subscriptions.update(platformSubscriptionId, {
          metadata: {
            pendingPlanChange: '',
            originalPriceId: '',
            targetPriceId: '',
            parentalControlRequest: '',
          },
        });

        console.log('Parental control metadata cleaned up successfully', {
          platformSubscriptionId,
        });

        return { success: true };
      },
      retryable: true,
      maxRetries: 2,
    },

    // ステップ5: ペアレンタルコントロール用プラン変更リクエストのステータスを更新
    // DynamoDBのPENDING_PLAN_CHANGES_TABLEのステータスを'approved'に更新し、
    // クライアントがポーリングで完了を検知できるようにする
    {
      stepName: 'update_plan_change_request_status',
      stepType: 'api_call',
      targetService: 'DynamoDB',
      executeFunction: async () => {
        // ペアレンタルコントロールによるプラン変更の場合のみ処理
        if (!isParentalControlPlanChange) {
          console.log(
            'Not a parental control plan change, skipping status update'
          );
          return { skipped: true, reason: 'not_parental_control_flow' };
        }

        // Stripeのmetadataからプラン変更リクエストIDを取得
        const metadata = (
          (stripeData as unknown as Stripe.Event).data?.object as
            | Stripe.Subscription
            | undefined
        )?.metadata;
        const planChangeRequestId = metadata?.planChangeRequestId;

        if (!planChangeRequestId) {
          console.warn(
            'Plan change request ID not found in metadata, skipping status update',
            {
              platformSubscriptionId,
              metadata,
            }
          );
          return { skipped: true, reason: 'no_request_id_in_metadata' };
        }

        if (!PENDING_PLAN_CHANGES_TABLE_NAME) {
          console.warn(
            'PENDING_PLAN_CHANGES_TABLE_NAME not configured, skipping status update'
          );
          return { skipped: true, reason: 'table_not_configured' };
        }

        console.log('Updating plan change request status to approved', {
          planChangeRequestId,
          platformSubscriptionId,
        });

        await dynamoDbClient.send(
          new UpdateItemCommand({
            TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
            Key: {
              requestId: { S: planChangeRequestId },
            },
            UpdateExpression: 'SET #status = :status, approvedAt = :approvedAt',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'approved' },
              ':approvedAt': { N: Date.now().toString() },
            },
          })
        );

        console.log('Plan change request status updated to approved', {
          planChangeRequestId,
        });

        return { success: true, planChangeRequestId };
      },
      retryable: true,
      maxRetries: 2,
    },

    // ステップ6: プラン変更の領収書メール送信（非ブロッキング）
    {
      stepName: 'send_plan_change_receipt',
      stepType: 'api_call',
      targetService: 'EmailService',
      executeFunction: async () => {
        try {
          console.log('Sending plan change receipt email', {
            tenantId,
            userId,
            platformSubscriptionId,
            currentPriceId,
          });

          // Stripe APIキーを取得
          const apiKey = await getStripeApiKey(tenantId);
          const stripe = new Stripe(apiKey, {
            apiVersion: '2025-10-29.clover',
          });

          // 最新のインボイスを取得
          const invoices = await stripe.invoices.list({
            subscription: platformSubscriptionId,
            limit: 1,
          });

          if (invoices.data.length === 0) {
            console.warn('No invoice found for plan change, skipping receipt', {
              platformSubscriptionId,
            });
            return { success: true, emailSent: false, reason: 'no_invoice' };
          }

          const invoice = invoices.data[0];

          // 冪等性チェック: 同一インボイスへの重複送信を防止
          const invoiceNumber = invoice.number;
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );

            const alreadySent =
              await idempotencyRepo.isReceiptAlreadySent(idempotencyKey);
            if (alreadySent) {
              console.log('Receipt already sent for this invoice, skipping', {
                invoiceNumber,
                idempotencyKey,
              });
              return {
                success: true,
                emailSent: false,
                reason: 'already_sent',
              };
            }
          }

          // 領収書データを構築
          const receiptDataBase = await buildReceiptDataFromInvoice(
            stripe,
            invoice.id,
            tenantId,
            currentPriceId as string
          );

          // 送信先を決定（ペアレンタルコントロール対応）
          const userEmail = userId
            ? await getUserEmail(tenantId, userId as string)
            : null;
          const recipient = await getReceiptRecipient(
            stripe,
            platformSubscriptionId,
            userEmail || undefined
          );

          const receiptData: ReceiptData = {
            ...receiptDataBase,
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            childEmail: recipient.childEmail,
          };

          // 領収書メール送信
          await sendPaymentReceipt(receiptData);

          // 送信完了を記録
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );
            await idempotencyRepo.markReceiptSent(idempotencyKey);
          }

          console.log('Plan change receipt email sent successfully', {
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            invoiceNumber,
          });

          return { success: true, emailSent: true };
        } catch (error) {
          // 領収書送信失敗はフローをブロックしない
          console.error('Failed to send plan change receipt email', {
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: true,
            emailSent: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      retryable: false,
      maxRetries: 0,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    (userId as string) || 'unknown',
    `${platform}_webhook_plan_change`,
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

  console.log('Processing refund.created event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから必要な情報を抽出
  // subscriptionIdはEventDetailPayloadのトップレベルにある（eventExtractorで抽出済み）
  const subscriptionId =
    input.subscriptionId || extractSubscriptionId(platform, eventData);
  const userId = input.userId || extractUserId(platform, eventData);

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
      targetFunction:
        process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME,
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

        const result =
          await subscriptionClient.updateSubscriptionStatus(params);

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

    console.log('Webhook event flow execution started', {
      flowExecutionId,
      eventId,
    });

    // 各ステップを順次実行
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      console.log(`Executing step ${i + 1}/${steps.length}: ${step.stepName}`);

      const result = await orchestrator.executeStep(flowExecutionId, i, step, {
        previousStepResults,
      });

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

    await orchestrator.completeFlow(
      flowExecutionId,
      output as unknown as Record<string, unknown>
    );

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
    throw new Error(`Webhook event flow failed: ${err.message}`, {
      cause: err,
    });
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
 * イベントデータから請求期間（periodStart/periodEnd）を抽出
 *
 * 決済プロバイダーから取得した正確な期間情報のみを使用します。
 * フォールバック値は使用せず、必須データが存在しない場合はエラーをthrowします。
 *
 * @param platform 決済プラットフォーム
 * @param eventData イベントデータ
 * @returns { periodStart, periodEnd } ISO 8601形式
 * @throws Error 必須の期間データが存在しない場合、または未実装のプラットフォームの場合
 */
function extractPeriodDates(
  platform: PlatformType,
  eventData: Record<string, unknown>
): { periodStart: string; periodEnd: string } {
  if (platform === 'stripe') {
    const stripeData = eventData as StripeEventData;

    // periodStart/periodEndがeventDataのトップレベルにある場合（eventExtractorで抽出済み）
    const rawPeriodStart = (eventData as Record<string, unknown>)
      .periodStart as number | undefined;
    const rawPeriodEnd = (eventData as Record<string, unknown>).periodEnd as
      | number
      | undefined;

    // eventDataのトップレベル、またはstripeDataから取得
    const periodStartValue = rawPeriodStart ?? stripeData.periodStart;
    const periodEndValue = rawPeriodEnd ?? stripeData.periodEnd;

    // 必須データの存在チェック
    if (!periodStartValue || !periodEndValue) {
      throw new Error(
        `Required billing period data not found in Stripe event. ` +
          `periodStart: ${periodStartValue}, periodEnd: ${periodEndValue}. ` +
          `This may indicate a bug in event extraction or an unexpected event structure.`
      );
    }

    return {
      periodStart: new Date(periodStartValue * 1000).toISOString(),
      periodEnd: new Date(periodEndValue * 1000).toISOString(),
    };
  }

  // Apple/Googleは現時点で未実装
  throw new Error(
    `Platform '${platform}' is not implemented for billing period extraction. ` +
      `Only Stripe is currently supported.`
  );
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

  console.log('Processing payment_method.updated event', {
    eventId,
    tenantId,
    platform,
  });

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

  console.log('Processing subscription.parental_activated event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから抽出情報を取得
  const stripeData = eventData as StripeEventData;
  const extracted = stripeData._extracted ?? {};
  const { sessionId, platformSubscriptionId, userId, planId, childEmail } =
    extracted;

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
        const purchaseFlowFunctionName =
          process.env.PURCHASE_FLOW_FUNCTION_NAME;

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

          throw new Error(
            `Purchase flow failed: ${invokeResult.FunctionError}`
          );
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
            flowOutput.errorDetails?.errorMessage || 'Purchase flow failed'
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

    // ステップ2: 領収書メール送信（ペアレンタルコントロール：保護者に送信）
    {
      stepName: 'send_parental_control_receipt',
      stepType: 'api_call',
      targetService: 'EmailService',
      executeFunction: async () => {
        try {
          console.log('Sending parental control receipt email', {
            tenantId,
            userId,
            sessionId,
            platformSubscriptionId,
          });

          // Stripe APIキーを取得
          const apiKey = await getStripeApiKey(tenantId);
          const stripe = new Stripe(apiKey, {
            apiVersion: '2025-10-29.clover',
          });

          // Checkout Sessionから最新のインボイスを取得
          const session = await stripe.checkout.sessions.retrieve(
            sessionId as string,
            {
              expand: ['invoice'],
            }
          );

          const invoice = session.invoice;
          if (!invoice || typeof invoice === 'string') {
            console.warn(
              'Invoice not found in checkout session, skipping receipt',
              { sessionId }
            );
            return { success: true, emailSent: false, reason: 'no_invoice' };
          }

          // 冪等性チェック: 同一インボイスへの重複送信を防止
          const invoiceNumber = invoice.number;
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );

            const alreadySent =
              await idempotencyRepo.isReceiptAlreadySent(idempotencyKey);
            if (alreadySent) {
              console.log('Receipt already sent for this invoice, skipping', {
                invoiceNumber,
                idempotencyKey,
              });
              return {
                success: true,
                emailSent: false,
                reason: 'already_sent',
              };
            }
          }

          // 領収書データを構築
          const receiptDataBase = await buildReceiptDataFromInvoice(
            stripe,
            invoice.id,
            tenantId,
            planId as string
          );

          // ペアレンタルコントロール：保護者のメールアドレスを取得
          const recipient = await getReceiptRecipient(
            stripe,
            platformSubscriptionId as string
          );

          const receiptData: ReceiptData = {
            ...receiptDataBase,
            recipientEmail: recipient.email,
            isParentalControl: true,
            childEmail: childEmail as string,
          };

          // 領収書メール送信
          await sendPaymentReceipt(receiptData);

          // 送信完了を記録
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );
            await idempotencyRepo.markReceiptSent(idempotencyKey);
          }

          console.log('Parental control receipt email sent successfully', {
            recipientEmail: recipient.email,
            childEmail,
            invoiceNumber,
          });

          return { success: true, emailSent: true };
        } catch (error) {
          // 領収書送信失敗はフローをブロックしない
          console.error('Failed to send parental control receipt email', {
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: true,
            emailSent: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      retryable: false,
      maxRetries: 0,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    (userId as string) || 'unknown',
    `${platform}_parental_control_webhook`,
    input,
    steps,
    eventId
  );
}

/**
 * subscription.plan_change_completed（プラン変更Checkout完了）イベントを処理
 *
 * Checkoutを経由したプラン変更が完了した際に発火。
 * 新しいサブスクリプションが作成され、古いサブスクリプションをキャンセルして切り替える。
 *
 * 処理ステップ:
 * 1. 古いStripeサブスクリプションをキャンセル
 * 2. 内部DBサブスクリプションを更新（新しいplatform_subscription_idとplan_id）
 * 3. 古いプラン適用を終了
 * 4. 新しいプランを適用
 *
 * @param input Webhookイベント入力
 * @param orchestrator フローオーケストレーター
 * @param planClient プラン管理クライアント
 * @param subscriptionClient サブスクリプション管理クライアント
 * @param tenantId テナントID
 * @returns 処理結果
 */
async function handlePlanChangeCompleted(
  input: EventDetailPayload,
  orchestrator: FlowOrchestrator,
  planClient: PlanManagementClient,
  subscriptionClient: SubscriptionManagementClient,
  tenantId: string
): Promise<WebhookEventFlowOutput> {
  const { eventId, platform, eventData } = input;

  console.log('Processing subscription.plan_change_completed event', {
    eventId,
    tenantId,
    platform,
  });

  // イベントデータから抽出情報を取得
  const stripeData: StripeEventData = eventData;
  const extracted = stripeData._extracted ?? {};
  const {
    userId,
    newPlanId,
    previousSubscriptionId: previousPlatformSubscriptionId,
    newPlatformSubscriptionId,
    internalSubscriptionId,
  } = extracted;

  console.log('Extracted plan change data from event', {
    userId,
    newPlanId,
    previousPlatformSubscriptionId,
    newPlatformSubscriptionId,
    internalSubscriptionId,
    hasExtracted: !!stripeData._extracted,
  });

  if (!userId) {
    throw new Error('User ID not found in event data');
  }

  if (!newPlanId) {
    throw new Error('New plan ID not found in event data');
  }

  if (!previousPlatformSubscriptionId) {
    throw new Error(
      'Previous platform subscription ID not found in event data'
    );
  }

  if (!newPlatformSubscriptionId) {
    throw new Error('New platform subscription ID not found in event data');
  }

  // 検証済みの値を定数として保持
  const validatedUserId = userId;
  const validatedNewPlanId = newPlanId;
  const validatedPreviousPlatformSubscriptionId =
    previousPlatformSubscriptionId;
  const validatedNewPlatformSubscriptionId = newPlatformSubscriptionId;
  const validatedInternalSubscriptionId = internalSubscriptionId;

  /**
   * 内部サブスクリプションIDを取得するヘルパー関数
   */
  const getInternalSubscriptionId = async (
    platformSubscriptionId: string
  ): Promise<string> => {
    if (validatedInternalSubscriptionId) {
      return validatedInternalSubscriptionId;
    }

    const subscription = await invokeDataAccessFunctionByTenantId<{
      subscription_id: string;
    } | null>(tenantId, 'subscription', 'findByPlatformSubscriptionId', {
      platformSubscriptionId,
    });

    if (!subscription) {
      throw new Error(
        `Internal subscription not found for platform subscription: ${platformSubscriptionId}`
      );
    }

    return subscription.subscription_id;
  };

  // ステップ設定
  const steps: StepConfig[] = [
    // ステップ1: 古いStripeサブスクリプションをキャンセル
    {
      stepName: 'cancel_previous_stripe_subscription',
      stepType: 'api_call',
      targetService: 'Stripe',
      executeFunction: async () => {
        console.log('Canceling previous Stripe subscription', {
          tenantId,
          previousPlatformSubscriptionId:
            validatedPreviousPlatformSubscriptionId,
        });

        const apiKey = await getStripeApiKey(tenantId);
        const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

        try {
          await stripe.subscriptions.cancel(
            validatedPreviousPlatformSubscriptionId,
            {
              prorate: true,
            }
          );

          console.log('Previous Stripe subscription canceled', {
            previousPlatformSubscriptionId:
              validatedPreviousPlatformSubscriptionId,
          });

          return {
            success: true,
            canceledSubscriptionId: validatedPreviousPlatformSubscriptionId,
          };
        } catch (error: any) {
          // サブスクリプションが存在しない場合は成功として扱う
          // （既にキャンセル済み、または別のwebhookで処理済み）
          if (
            error?.code === 'resource_missing' ||
            error?.message?.includes('No such subscription')
          ) {
            console.log(
              'Previous Stripe subscription not found, treating as already canceled',
              {
                previousPlatformSubscriptionId:
                  validatedPreviousPlatformSubscriptionId,
                error: error.message,
              }
            );
            return {
              success: true,
              alreadyCanceled: true,
              canceledSubscriptionId: validatedPreviousPlatformSubscriptionId,
            };
          }
          // その他のエラーは再スロー
          throw error;
        }
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ2: 内部DBサブスクリプションを更新
    {
      stepName: 'update_internal_subscription',
      stepType: 'api_call',
      targetService: 'SubscriptionManagement',
      executeFunction: async () => {
        const subscriptionId = await getInternalSubscriptionId(
          validatedPreviousPlatformSubscriptionId
        );

        console.log('Updating internal subscription', {
          subscriptionId,
          newPlatformSubscriptionId: validatedNewPlatformSubscriptionId,
          newPlanId: validatedNewPlanId,
        });

        await invokeDataAccessFunctionByTenantId<{ subscription_id: string }>(
          tenantId,
          'subscription',
          'update',
          {
            subscriptionId,
            updates: {
              platform_subscription_id: validatedNewPlatformSubscriptionId,
              plan_id: validatedNewPlanId,
            },
          }
        );

        console.log('Internal subscription updated', {
          subscriptionId,
          newPlatformSubscriptionId: validatedNewPlatformSubscriptionId,
          newPlanId: validatedNewPlanId,
        });

        return {
          success: true,
          subscriptionId,
        };
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ3: 古いプラン適用を終了
    {
      stepName: 'terminate_previous_plan_application',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME,
      executeFunction: async () => {
        // ステップ2で更新済みなので新しいplatform_subscription_idで検索
        const subscriptionId = await getInternalSubscriptionId(
          validatedNewPlatformSubscriptionId
        );

        console.log('Terminating previous plan application', {
          tenantId,
          userId: validatedUserId,
          subscriptionId,
        });

        const result = await planClient.terminatePlanApplication({
          tenantId,
          userId: validatedUserId,
          applicationSourceId: subscriptionId,
        });

        console.log('Previous plan application terminated', {
          applicationId: result.applicationId,
          success: result.success,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ4: 新しいプランを適用
    {
      stepName: 'apply_new_plan',
      stepType: 'api_call',
      targetService: 'PlanManagement',
      targetFunction: process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME,
      executeFunction: async () => {
        const subscriptionId = await getInternalSubscriptionId(
          validatedNewPlatformSubscriptionId
        );

        console.log('Applying new plan to user', {
          tenantId,
          userId: validatedUserId,
          planId: validatedNewPlanId,
          subscriptionId,
        });

        const result = await planClient.applyPlanToUser({
          tenantId,
          userId: validatedUserId,
          planId: validatedNewPlanId,
          applicationSource: 'subscription',
          applicationSourceId: subscriptionId,
          validFrom: new Date().toISOString(),
        });

        console.log('New plan applied successfully', {
          applicationId: result.applicationId,
          applicationStatus: result.applicationStatus,
        });

        return result;
      },
      retryable: true,
      maxRetries: 3,
    },

    // ステップ5: プラン変更Checkoutの領収書メール送信（非ブロッキング）
    {
      stepName: 'send_checkout_plan_change_receipt',
      stepType: 'api_call',
      targetService: 'EmailService',
      executeFunction: async () => {
        try {
          console.log('Sending checkout plan change receipt email', {
            tenantId,
            userId: validatedUserId,
            newPlatformSubscriptionId: validatedNewPlatformSubscriptionId,
            newPlanId: validatedNewPlanId,
          });

          // Stripe APIキーを取得
          const apiKey = await getStripeApiKey(tenantId);
          const stripe = new Stripe(apiKey, {
            apiVersion: '2025-10-29.clover',
          });

          // 新しいサブスクリプションの最新インボイスを取得
          const invoices = await stripe.invoices.list({
            subscription: validatedNewPlatformSubscriptionId,
            limit: 1,
          });

          if (invoices.data.length === 0) {
            console.warn(
              'No invoice found for checkout plan change, skipping receipt',
              {
                newPlatformSubscriptionId: validatedNewPlatformSubscriptionId,
              }
            );
            return { success: true, emailSent: false, reason: 'no_invoice' };
          }

          const invoice = invoices.data[0];

          // 冪等性チェック: 同一インボイスへの重複送信を防止
          const invoiceNumber = invoice.number;
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );

            const alreadySent =
              await idempotencyRepo.isReceiptAlreadySent(idempotencyKey);
            if (alreadySent) {
              console.log('Receipt already sent for this invoice, skipping', {
                invoiceNumber,
                idempotencyKey,
              });
              return {
                success: true,
                emailSent: false,
                reason: 'already_sent',
              };
            }
          }

          // 領収書データを構築
          const receiptDataBase = await buildReceiptDataFromInvoice(
            stripe,
            invoice.id,
            tenantId,
            validatedNewPlanId
          );

          // 送信先を決定（ペアレンタルコントロール対応）
          const userEmail = await getUserEmail(tenantId, validatedUserId);
          const recipient = await getReceiptRecipient(
            stripe,
            validatedNewPlatformSubscriptionId,
            userEmail || undefined
          );

          const receiptData: ReceiptData = {
            ...receiptDataBase,
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            childEmail: recipient.childEmail,
          };

          // 領収書メール送信
          await sendPaymentReceipt(receiptData);

          // 送信完了を記録
          if (invoiceNumber) {
            const idempotencyRepo = new IdempotencyRepository(tenantId);
            const idempotencyKey = IdempotencyRepository.generateReceiptKey(
              tenantId,
              invoiceNumber
            );
            await idempotencyRepo.markReceiptSent(idempotencyKey);
          }

          console.log('Checkout plan change receipt email sent successfully', {
            recipientEmail: recipient.email,
            isParentalControl: recipient.isParentalControl,
            invoiceNumber,
          });

          return { success: true, emailSent: true };
        } catch (error) {
          // 領収書送信失敗はフローをブロックしない
          console.error('Failed to send checkout plan change receipt email', {
            eventId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: true,
            emailSent: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      retryable: false,
      maxRetries: 0,
    },
  ];

  // フロー実行
  return await executeWebhookEventFlow(
    orchestrator,
    'webhook_event',
    validatedUserId,
    `${platform}_plan_change_webhook`,
    input,
    steps,
    eventId
  );
}
