import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { verifyGooglePubSubMessage } from '../../utils/signatureVerifier';
import { WebhookEventRepository } from '../../repositories/webhookEventRepository';
import { isDuplicateEvent } from '../../utils/eventDeduplicator';
import { WebhookEvent } from '../../repositories/types';

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received Google Real-time Developer Notification');

  try {
    // 1. パスパラメータからテナントIDを取得
    const tenantId = event.pathParameters?.tenantId;
    const eventBusName = process.env.EVENT_BUS_NAME;
    const packageName = process.env.GOOGLE_PACKAGE_NAME;

    if (!tenantId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'tenantId is required' }),
      };
    }

    if (!eventBusName || !packageName) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Environment variables not set' }),
      };
    }

    console.log(`Processing Google notification for tenant: ${tenantId}`);

    // 2. テーブル名を動的に構築
    const webhookEventTableName = `${tenantId}-payment-gateway-webhook-events`;

    // リクエストボディを取得（Pub/Subメッセージフォーマット）
    const payload = event.body;

    if (!payload) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing payload' }),
      };
    }

    // Pub/Subメッセージをパース
    const pubsubMessage = JSON.parse(payload);
    const messageData = pubsubMessage.message?.data;

    if (!messageData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing message.data' }),
      };
    }

    // メッセージデータを検証
    const isValid = verifyGooglePubSubMessage(messageData);

    if (!isValid) {
      console.error('Google Pub/Sub message verification failed');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid message format' }),
      };
    }

    console.log('Google Pub/Sub message verified successfully');

    // Base64デコードしてイベントを取得
    const decodedData = Buffer.from(messageData, 'base64').toString();
    const notification = JSON.parse(decodedData);

    // イベントIDを生成（Google通知にはUUIDがないため、メッセージIDを使用）
    const messageId = pubsubMessage.message?.messageId;
    const notificationType =
      notification.subscriptionNotification?.notificationType ||
      notification.testNotification?.version;

    if (!messageId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing messageId' }),
      };
    }

    // イベントリポジトリを初期化
    const eventRepository = new WebhookEventRepository(webhookEventTableName);

    // 重複チェック
    const isDuplicate = await isDuplicateEvent(messageId, eventRepository);

    if (isDuplicate) {
      console.log(`Duplicate event detected: ${messageId}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true }),
      };
    }

    // イベントを保存
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // 90日後

    const webhookEvent: WebhookEvent = {
      event_id: messageId,
      received_at: now.toISOString(),
      platform_type: 'google',
      event_type: notificationType?.toString() || 'unknown',
      event_data: notification,
      processed_status: 'pending',
      ttl,
    };

    await eventRepository.save(webhookEvent);

    console.log(`Webhook event saved: ${messageId}`);

    // EventBridgeに送信
    const eventBridgeClient = new EventBridgeClient({});

    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: 'payment-gateway.webhook',
          DetailType: 'GoogleWebhookReceived',
          Detail: JSON.stringify({
            platform: 'google',
            eventId: messageId,
            eventType: notificationType,
            eventData: notification,
            tenantId,
          }),
          EventBusName: eventBusName,
        },
      ],
    });

    await eventBridgeClient.send(putEventsCommand);

    console.log(`Event sent to EventBridge: ${messageId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error('Error processing Google notification:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
