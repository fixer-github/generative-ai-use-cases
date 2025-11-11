import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { verifyAppleJws } from '../../utils/signatureVerifier';
import { WebhookEventRepository } from '../../repositories/webhookEventRepository';
import { isDuplicateEvent } from '../../utils/eventDeduplicator';
import { WebhookEvent } from '../../repositories/types';

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received Apple Server Notification');

  try {
    const tenantId = process.env.TENANT_ID || event.queryStringParameters?.tenantId;
    const eventBusName = process.env.EVENT_BUS_NAME;
    const webhookEventTableName = process.env.WEBHOOK_EVENT_TABLE_NAME;
    const bundleId = process.env.APPLE_BUNDLE_ID;

    if (!tenantId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'tenantId is required' }),
      };
    }

    if (!eventBusName || !webhookEventTableName || !bundleId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Environment variables not set' }),
      };
    }

    // リクエストボディを取得
    const payload = event.body;

    if (!payload) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing payload' }),
      };
    }

    // ペイロードをパース
    const notification = JSON.parse(payload);

    // JWS署名を検証
    const signedPayload = notification.signedPayload;

    if (!signedPayload) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing signedPayload' }),
      };
    }

    const isValid = await verifyAppleJws(signedPayload);

    if (!isValid) {
      console.error('Apple JWS verification failed');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    console.log('Apple JWS verified successfully');

    // JWSをデコードしてイベントIDを抽出
    const parts = signedPayload.split('.');
    const decodedPayload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );

    const notificationUUID = decodedPayload.notificationUUID;
    const notificationType = decodedPayload.notificationType;

    if (!notificationUUID) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing notificationUUID' }),
      };
    }

    // イベントリポジトリを初期化
    const eventRepository = new WebhookEventRepository(webhookEventTableName);

    // 重複チェック
    const isDuplicate = await isDuplicateEvent(notificationUUID, eventRepository);

    if (isDuplicate) {
      console.log(`Duplicate event detected: ${notificationUUID}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true }),
      };
    }

    // イベントを保存
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // 90日後

    const webhookEvent: WebhookEvent = {
      event_id: notificationUUID,
      received_at: now.toISOString(),
      platform_type: 'apple',
      event_type: notificationType,
      event_data: decodedPayload,
      processed_status: 'pending',
      ttl,
    };

    await eventRepository.save(webhookEvent);

    console.log(`Webhook event saved: ${notificationUUID}`);

    // EventBridgeに送信
    const eventBridgeClient = new EventBridgeClient({});

    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: 'payment-gateway.webhook',
          DetailType: 'AppleWebhookReceived',
          Detail: JSON.stringify({
            platform: 'apple',
            eventId: notificationUUID,
            eventType: notificationType,
            eventData: decodedPayload,
            tenantId,
          }),
          EventBusName: eventBusName,
        },
      ],
    });

    await eventBridgeClient.send(putEventsCommand);

    console.log(`Event sent to EventBridge: ${notificationUUID}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error('Error processing Apple notification:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
