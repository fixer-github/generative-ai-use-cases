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
import { mapStripeEventToBusinessEvent } from './eventMapper';
import { extractEventDetail } from './eventExtractor';

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
    // Note: API Gateway HTTP API v2 lowercases all header names
    const payload = event.body;
    const signature =
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

    if (!payload || !signature) {
      console.error('Missing payload or signature:', {
        hasPayload: !!payload,
        hasSignature: !!signature,
        headerKeys: Object.keys(event.headers || {}),
      });
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

    // ビジネスイベントにマッピング（動的マッピング用にイベントオブジェクトも渡す）
    const businessEventType = mapStripeEventToBusinessEvent(eventType, stripeEvent);

    if (!businessEventType) {
      // マッピング対象外のイベントはスキップ（またはログのみ記録）
      console.log(
        `Event type ${eventType} is not mapped to business event. Skipping EventBridge send.`
      );
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, skipped: true }),
      };
    }

    console.log(
      `Mapped Stripe event ${eventType} to business event ${businessEventType}`
    );

    // イベント詳細情報の抽出
    let eventDetail;
    try {
      eventDetail = await extractEventDetail(stripeEvent, tenantId);
    } catch (error) {
      console.error('Failed to extract event details:', error);
      // 抽出失敗時もイベントは受信済みとして扱う
      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true,
          error: 'Failed to extract event details',
        }),
      };
    }

    // EventBridgeに送信（正規化された形式）
    const eventBridgeClient = new EventBridgeClient({});

    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: 'billing.payment-gateway',
          DetailType: businessEventType,
          Detail: JSON.stringify(eventDetail),
          EventBusName: eventBusName,
        },
      ],
    });

    await eventBridgeClient.send(putEventsCommand);

    console.log(
      `Business event sent to EventBridge: ${businessEventType} (original: ${eventId})`
    );

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
