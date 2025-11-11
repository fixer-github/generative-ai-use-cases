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
let webhookSecretCache: string | null = null;

/**
 * Secrets Managerから Webhook Secret を取得する
 */
async function getWebhookSecret(): Promise<string> {
  if (webhookSecretCache) {
    return webhookSecretCache;
  }

  const secretArn = process.env.STRIPE_WEBHOOK_SECRET_ARN;
  if (!secretArn) {
    throw new Error('STRIPE_WEBHOOK_SECRET_ARN is not set');
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretArn });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error('Webhook secret is empty');
  }

  const secret = JSON.parse(response.SecretString);
  webhookSecretCache = secret.webhookSecret;

  return webhookSecretCache!;
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received Stripe webhook request');

  try {
    const tenantId = process.env.TENANT_ID || event.queryStringParameters?.tenantId;
    const eventBusName = process.env.EVENT_BUS_NAME;
    const webhookEventTableName = process.env.WEBHOOK_EVENT_TABLE_NAME;

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

    if (!webhookEventTableName) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'WEBHOOK_EVENT_TABLE_NAME is not set' }),
      };
    }

    // リクエストボディと署名を取得
    const payload = event.body;
    const signature = event.headers['stripe-signature'];

    if (!payload || !signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing payload or signature' }),
      };
    }

    // Webhook Secretを取得
    const webhookSecret = await getWebhookSecret();

    // 署名検証
    const isValid = verifyStripeSignature(payload, signature, webhookSecret);

    if (!isValid) {
      console.error('Stripe signature verification failed');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    console.log('Stripe signature verified successfully');

    // イベントをパース
    const stripeEvent = JSON.parse(payload);
    const eventId = stripeEvent.id;
    const eventType = stripeEvent.type;

    // イベントリポジトリを初期化
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
