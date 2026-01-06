/**
 * Permission Grant Repository
 * 権限付与履歴テーブルへのアクセスを管理
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { PermissionGrantItem } from './types';

export class PermissionGrantRepository {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(client: DynamoDBClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * 権限付与履歴を作成
   */
  async create(item: PermissionGrantItem): Promise<void> {
    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await this.client.send(command);
  }

  /**
   * 権限付与履歴を取得
   */
  async get(grantId: string): Promise<PermissionGrantItem | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({
        grantId,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      return null;
    }

    return unmarshall(result.Item) as PermissionGrantItem;
  }

  /**
   * ユーザIDと状態で検索
   */
  async findByUserIdAndStatus(
    userId: string,
    status: 'active' | 'revoked'
  ): Promise<PermissionGrantItem[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'userId-status-index',
      KeyConditionExpression: 'userId = :userId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':status': status,
      }),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map(
      (item) => unmarshall(item) as PermissionGrantItem
    );
  }

  /**
   * 状態を更新（剥奪時）
   */
  async updateStatus(
    grantId: string,
    status: 'revoked',
    revokedAt: number
  ): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({
        grantId,
      }),
      UpdateExpression: 'SET #status = :status, revokedAt = :revokedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
        ':revokedAt': revokedAt,
      }),
    });

    await this.client.send(command);
  }

  /**
   * sourceIdで検索（activeな権限のみ）
   * application_idからgrantIdを取得するために使用
   */
  async findBySourceId(sourceId: string): Promise<PermissionGrantItem | null> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'sourceId = :sourceId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':sourceId': sourceId,
        ':status': 'active',
      }),
    });

    const result = await this.client.send(command);

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // sourceIdは一意であることを想定しているため、最初の1件を返す
    return unmarshall(result.Items[0]) as PermissionGrantItem;
  }

  /**
   * 請求期間を更新
   * サブスクリプション更新時にperiodStart/periodEndを更新するために使用
   */
  async updatePeriod(
    grantId: string,
    periodStart: number,
    periodEnd: number
  ): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({
        grantId,
      }),
      UpdateExpression: 'SET periodStart = :periodStart, periodEnd = :periodEnd',
      ExpressionAttributeValues: marshall({
        ':periodStart': periodStart,
        ':periodEnd': periodEnd,
      }),
    });

    await this.client.send(command);
  }
}
