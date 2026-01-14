/**
 * Usage Event Repository
 * 使用イベントテーブルへのアクセスを管理
 */

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { UsageEventItem } from './types';

export class UsageEventRepository {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(client: DynamoDBClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * 使用イベントを記録
   */
  async recordEvent(item: UsageEventItem): Promise<void> {
    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await this.client.send(command);
  }

  /**
   * 指定期間内の使用回数を集計
   * @param userId ユーザID
   * @param featureId 機能ID
   * @param startTime 開始時刻（Unixタイムスタンプ、ミリ秒単位）
   * @param endTime 終了時刻（Unixタイムスタンプ、ミリ秒単位）
   * @returns 使用回数
   */
  async countUsageInPeriod(
    userId: string,
    featureId: string,
    startTime: number,
    endTime: number
  ): Promise<number> {
    console.log(
      `[UsageEventRepository.countUsageInPeriod] Counting events - tableName: ${this.tableName}, userId: ${userId}, featureId: ${featureId}, startTime: ${startTime}, endTime: ${endTime}`
    );

    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression:
        'userId = :userId AND #timestamp BETWEEN :startTime AND :endTime',
      FilterExpression: 'featureId = :featureId',
      ExpressionAttributeNames: {
        '#timestamp': 'timestamp',
      },
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':featureId': featureId,
        ':startTime': startTime,
        ':endTime': endTime,
      }),
      Select: 'COUNT',
    });

    const result = await this.client.send(command);

    const count = result.Count || 0;
    console.log(
      `[UsageEventRepository.countUsageInPeriod] Found ${count} events for user ${userId}, feature ${featureId} in period`
    );

    return count;
  }

  /**
   * 指定期間内の使用イベントを取得（詳細確認用）
   * @param userId ユーザID
   * @param featureId 機能ID
   * @param startTime 開始時刻（Unixタイムスタンプ、ミリ秒単位）
   * @param endTime 終了時刻（Unixタイムスタンプ、ミリ秒単位）
   * @returns 使用イベントの配列
   */
  async getEventsInPeriod(
    userId: string,
    featureId: string,
    startTime: number,
    endTime: number
  ): Promise<UsageEventItem[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression:
        'userId = :userId AND #timestamp BETWEEN :startTime AND :endTime',
      FilterExpression: 'featureId = :featureId',
      ExpressionAttributeNames: {
        '#timestamp': 'timestamp',
      },
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':featureId': featureId,
        ':startTime': startTime,
        ':endTime': endTime,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map((item) => unmarshall(item) as UsageEventItem);
  }
}
