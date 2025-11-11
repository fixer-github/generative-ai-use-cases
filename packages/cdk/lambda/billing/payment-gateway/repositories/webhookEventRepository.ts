import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { WebhookEvent } from './types';

export class WebhookEventRepository {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.client = client || new DynamoDBClient({});
  }

  /**
   * Webhookイベントを保存する
   */
  async save(event: WebhookEvent): Promise<void> {
    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(event, { removeUndefinedValues: true }),
    });

    await this.client.send(command);
  }

  /**
   * イベントIDでWebhookイベントを取得する（重複チェック用）
   */
  async findByEventId(eventId: string): Promise<WebhookEvent | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ event_id: eventId }),
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      return null;
    }

    return unmarshall(result.Item) as WebhookEvent;
  }

  /**
   * 日付範囲でWebhookイベントを取得する
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    platformType?: string
  ): Promise<WebhookEvent[]> {
    const indexName = platformType ? 'PlatformTypeIndex' : undefined;
    const keyConditionExpression = platformType
      ? 'platform_type = :platform_type AND received_at BETWEEN :start_date AND :end_date'
      : 'received_at BETWEEN :start_date AND :end_date';

    const expressionAttributeValues: Record<string, any> = {
      ':start_date': startDate.toISOString(),
      ':end_date': endDate.toISOString(),
    };

    if (platformType) {
      expressionAttributeValues[':platform_type'] = platformType;
    }

    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map((item) => unmarshall(item) as WebhookEvent);
  }
}
