/**
 * Usage Count Repository
 * 利用回数カウントテーブルへのアクセスを管理
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
  WriteRequest,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { UsageCounterItem } from './types';

export class UsageCountRepository {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(client: DynamoDBClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * カウンター情報を作成
   */
  async create(item: UsageCounterItem): Promise<void> {
    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await this.client.send(command);
  }

  /**
   * カウンター情報を取得
   */
  async get(
    userId: string,
    featureIdPeriod: string
  ): Promise<UsageCounterItem | null> {
    console.log(
      `[UsageCountRepository.get] Fetching counter - tableName: ${this.tableName}, userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
    );

    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({
        userId,
        featureIdPeriod,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      console.log(
        `[UsageCountRepository.get] Counter not found - userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
      );
      return null;
    }

    const item = unmarshall(result.Item) as UsageCounterItem;
    console.log(
      `[UsageCountRepository.get] Counter found - userId: ${userId}, featureIdPeriod: ${featureIdPeriod}, currentCount: ${item.currentCount}, limitCount: ${item.limitCount}`
    );

    return item;
  }

  /**
   * カウンターをアトミックに加算
   */
  async increment(
    userId: string,
    featureIdPeriod: string
  ): Promise<number> {
    console.log(
      `[UsageCountRepository.increment] Starting increment - tableName: ${this.tableName}, userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
    );

    const now = Math.floor(Date.now() / 1000);

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({
        userId,
        featureIdPeriod,
      }),
      UpdateExpression:
        'ADD currentCount :inc SET updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':inc': 1,
        ':updatedAt': now,
      }),
      ReturnValues: 'ALL_NEW',
    });

    const result = await this.client.send(command);

    if (!result.Attributes) {
      console.error(
        `[UsageCountRepository.increment] Failed to increment counter - userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
      );
      throw new Error(
        `Failed to increment counter for userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
      );
    }

    const item = unmarshall(result.Attributes) as UsageCounterItem;
    console.log(
      `[UsageCountRepository.increment] Successfully incremented - userId: ${userId}, featureIdPeriod: ${featureIdPeriod}, newCount: ${item.currentCount}, limitCount: ${item.limitCount}`
    );

    return item.currentCount;
  }

  /**
   * 権限付与IDでカウンター情報を検索
   */
  async findByGrantId(grantId: string): Promise<UsageCounterItem[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'grantId-index',
      KeyConditionExpression: 'grantId = :grantId',
      ExpressionAttributeValues: marshall({
        ':grantId': grantId,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map((item) => unmarshall(item) as UsageCounterItem);
  }

  /**
   * 期間タイプとリセット日時でカウンター情報を検索（バッチリセット用）
   */
  async findByPeriodTypeAndResetTime(
    periodType: 'daily' | 'monthly',
    beforeTime: number
  ): Promise<UsageCounterItem[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'periodType-nextResetTime-index',
      KeyConditionExpression:
        'periodType = :periodType AND nextResetTime <= :beforeTime',
      ExpressionAttributeValues: marshall({
        ':periodType': periodType,
        ':beforeTime': beforeTime,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map((item) => unmarshall(item) as UsageCounterItem);
  }

  /**
   * カウンターをリセット
   */
  async reset(
    userId: string,
    featureIdPeriod: string,
    nextResetTime: number
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({
        userId,
        featureIdPeriod,
      }),
      UpdateExpression:
        'SET currentCount = :zero, nextResetTime = :nextResetTime, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':zero': 0,
        ':nextResetTime': nextResetTime,
        ':updatedAt': now,
      }),
    });

    await this.client.send(command);
  }

  /**
   * カウンター情報を一括削除
   */
  async batchDelete(
    items: Array<{ userId: string; featureIdPeriod: string }>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    // DynamoDBのBatchWriteは最大25件まで
    const BATCH_SIZE = 25;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      const deleteRequests: WriteRequest[] = batch.map((item) => ({
        DeleteRequest: {
          Key: marshall({
            userId: item.userId,
            featureIdPeriod: item.featureIdPeriod,
          }),
        },
      }));

      const command = new BatchWriteItemCommand({
        RequestItems: {
          [this.tableName]: deleteRequests,
        },
      });

      await this.client.send(command);
    }
  }
}
