import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ReceiptCache, VerificationResult } from './types';
import { createHash } from 'crypto';

export class ReceiptCacheRepository {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(tableName: string, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.client = client || new DynamoDBClient({});
  }

  /**
   * レシート検証結果をキャッシュに保存する
   * TTLは24時間後に設定
   */
  async save(
    receipt: string,
    verificationResult: VerificationResult
  ): Promise<void> {
    const receiptHash = this.hashReceipt(receipt);
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 24 * 60 * 60; // 24時間後

    const cache: ReceiptCache = {
      receipt_hash: receiptHash,
      verification_result: verificationResult,
      verified_at: now.toISOString(),
      ttl,
    };

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(cache, { removeUndefinedValues: true }),
    });

    await this.client.send(command);
  }

  /**
   * レシートハッシュでキャッシュを取得する
   */
  async findByReceiptHash(receipt: string): Promise<VerificationResult | null> {
    const receiptHash = this.hashReceipt(receipt);

    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ receipt_hash: receiptHash }),
    });

    const result = await this.client.send(command);

    if (!result.Item) {
      return null;
    }

    const cache = unmarshall(result.Item) as ReceiptCache;

    // TTLチェック（DynamoDBのTTL削除は遅延があるため、手動でもチェック）
    const now = Math.floor(Date.now() / 1000);
    if (cache.ttl < now) {
      return null;
    }

    // キャッシュから取得したことを示すフラグを追加
    return {
      ...cache.verification_result,
      cached: true,
    };
  }

  /**
   * レシートをSHA256でハッシュ化
   */
  private hashReceipt(receipt: string): string {
    return createHash('sha256').update(receipt).digest('hex');
  }
}
