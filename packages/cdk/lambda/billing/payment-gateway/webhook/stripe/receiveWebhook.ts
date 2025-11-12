import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { verifyStripeSignature } from '../../utils/signatureVerifier';
import { WebhookEventRepository } from '../../repositories/webhookEventRepository';
import { isDuplicateEvent } from '../../utils/eventDeduplicator';
import { WebhookEvent } from '../../repositories/types';

/**
 * シークレットのキャッシュ（コールドスタート対策）
 */
const webhookSecretCache: Record<string, string> = {};

/**
 * Secrets Managerから Webhook Secret を取得する
 */
async function getWebhookSecret(tenantId: string): Promise<string> {
  const secretName = `${tenantId}/billing/stripe`;

  if (webhookSecretCache[secretName]) {
    return webhookSecretCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Webhook secret is empty for ${secretName}`);
  }

  const secret = JSON.parse(response.SecretString);
  webhookSecretCache[secretName] = secret.webhookSecret;

  return webhookSecretCache[secretName];
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received Stripe webhook request');

  try {
    // 1. パスパラメータからテナントIDを取得
    const tenantId = event.pathParameters?.tenantId;
    const eventBusName = process.env.EVENT_BUS_NAME;

    if (!tenantId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'tenantId is required' }),
      };
    }

    if (!eventBusName) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'EVENT_BUS_NAME is not set' }),
      };
    }

    console.log(`Processing Stripe webhook for tenant: ${tenantId}`);

    // 2. テーブル名を動的に構築
    const webhookEventTableName = `${tenantId}-payment-gateway-webhook-events`;

    // 3. リクエストボディと署名を取得
    const payload = event.body;
    const signature = event.headers['stripe-signature'];

    if (!payload || !signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing payload or signature' }),
      };
    }

    // 4. Webhook Secretを取得（テナント専用）
    const webhookSecret = await getWebhookSecret(tenantId);

    // 5. 署名検証
    const isValid = verifyStripeSignature(payload, signature, webhookSecret);

    if (!isValid) {
      console.error('Stripe signature verification failed');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    console.log('Stripe signature verified successfully');

    // 6. イベントをパース
    const stripeEvent = JSON.parse(payload);
    const eventId = stripeEvent.id;
    const eventType = stripeEvent.type;

    // 7. イベントリポジトリを初期化
    const eventRepository = new WebhookEventRepository(webhookEventTableName);

    // 重複チェック
    const isDuplicate = await isDuplicateEvent(eventId, eventRepository);

    if (isDuplicate) {
      console.log(`Duplicate event detected: ${eventId}`);
      // 重複イベントは正常に受信したものとして200を返す（冪等性保証）
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true }),
      };
    }

    // イベントを保存
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // 90日後

    const webhookEvent: WebhookEvent = {
      event_id: eventId,
      received_at: now.toISOString(),
      platform_type: 'stripe',
      event_type: eventType,
      event_data: stripeEvent,
      processed_status: 'pending',
      ttl,
    };

    await eventRepository.save(webhookEvent);

    console.log(`Webhook event saved: ${eventId}`);

    // EventBridgeに送信
    const eventBridgeClient = new EventBridgeClient({});

    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: 'payment-gateway.webhook',
          DetailType: 'StripeWebhookReceived',
          Detail: JSON.stringify({
            platform: 'stripe',
            eventId,
            eventType,
            eventData: stripeEvent,
            tenantId,
          }),
          EventBusName: eventBusName,
        },
      ],
    });

    await eventBridgeClient.send(putEventsCommand);

    console.log(`Event sent to EventBridge: ${eventId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error('Error processing Stripe webhook:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
