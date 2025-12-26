/**
 * Idempotency Repository
 *
 * Manages idempotency records for purchase flow in DynamoDB.
 * Ensures exactly-once processing by tracking processed session IDs.
 *
 * 冪等性テーブルスキーマ:
 * - idempotencyKey (PK): 冪等性キー（例: "PURCHASE#{tenantId}#{sessionId}"）
 * - status: 処理ステータス（'processing' | 'completed' | 'failed'）
 * - flowExecutionId: フロー実行ID
 * - result: 処理結果（成功時/失敗時の結果を保存）
 * - createdAt: 作成日時
 * - updatedAt: 更新日時
 * - ttl: TTL（30日後に自動削除）
 *
 * Database Per Tenantsパターンに従い、テナント専用のDynamoDBテーブルにアクセスします。
 * テーブル名: {tenantId}-orchestration-idempotency
 */

import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { PurchaseFlowOutput } from '../types/flowTypes';
import { createTenantDynamoDBClientForBackgroundJob } from '../../../utils/tenantDynamoDBClient';

/**
 * 冪等性レコードのステータス
 */
export type IdempotencyStatus = 'processing' | 'completed' | 'failed';

/**
 * 冪等性レコード
 */
export interface IdempotencyRecord {
  /** 冪等性キー（PK） */
  idempotencyKey: string;
  /** 処理ステータス */
  status: IdempotencyStatus;
  /** フロー実行ID */
  flowExecutionId?: string;
  /** 処理結果（成功時/失敗時） */
  result?: PurchaseFlowOutput;
  /** 作成日時（Unixタイムスタンプ、ミリ秒） */
  createdAt: number;
  /** 更新日時（Unixタイムスタンプ、ミリ秒） */
  updatedAt: number;
  /** TTL（Unixタイムスタンプ、秒） */
  ttl: number;
}

/**
 * 冪等性チェック結果
 */
export interface IdempotencyCheckResult {
  /** 既に処理済みかどうか */
  alreadyProcessed: boolean;
  /** 処理中かどうか（他のリクエストが処理中の場合） */
  inProgress: boolean;
  /** 既存のレコード（存在する場合） */
  existingRecord?: IdempotencyRecord;
}

/**
 * Idempotency Repository
 *
 * 購入フローの冪等性を管理するリポジトリ
 * Database Per Tenantsパターンに従い、tenantIdからテーブル名を動的生成
 */
export class IdempotencyRepository {
  private docClient: DynamoDBDocumentClient | null = null;
  private readonly tenantId: string;
  private readonly tableName: string;

  /**
   * TTL: 30日（秒）
   */
  private static readonly TTL_SECONDS = 30 * 24 * 60 * 60;

  /**
   * コンストラクタ
   *
   * @param tenantId - テナントID
   */
  constructor(tenantId: string) {
    this.tenantId = tenantId;
    // テーブル名はtenantIdから動的生成
    this.tableName = `${tenantId}-orchestration-idempotency`;
  }

  /**
   * DynamoDB Document Clientを取得（遅延初期化）
   * createTenantDynamoDBClientForBackgroundJobを使用してテナント固有のクライアントを作成
   */
  private async getDocClient(): Promise<DynamoDBDocumentClient> {
    if (!this.docClient) {
      const dynamoClient = await createTenantDynamoDBClientForBackgroundJob(this.tenantId);
      this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
    }
    return this.docClient;
  }

  /**
   * 冪等性キーを生成
   *
   * @param tenantId - テナントID
   * @param sessionId - セッションID（Stripeの場合はCheckout Session ID）
   * @returns 冪等性キー
   */
  static generateKey(tenantId: string, sessionId: string): string {
    return `PURCHASE#${tenantId}#${sessionId}`;
  }

  /**
   * 領収書メール用の冪等性キーを生成
   *
   * @param tenantId - テナントID
   * @param invoiceNumber - 請求書番号（Stripeのinvoice.number）
   * @returns 冪等性キー
   */
  static generateReceiptKey(tenantId: string, invoiceNumber: string): string {
    return `RECEIPT#${tenantId}#${invoiceNumber}`;
  }

  /**
   * 領収書が既に送信済みかチェック（簡易版）
   *
   * 送信済みの場合はtrueを返し、未送信の場合はfalseを返してレコードを作成する。
   *
   * @param idempotencyKey - 冪等性キー（generateReceiptKeyで生成）
   * @returns 既に送信済みかどうか
   */
  async isReceiptAlreadySent(idempotencyKey: string): Promise<boolean> {
    const checkResult = await this.reserveOrGetExisting(idempotencyKey);
    return checkResult.alreadyProcessed || checkResult.inProgress;
  }

  /**
   * 領収書送信完了を記録
   *
   * @param idempotencyKey - 冪等性キー
   */
  async markReceiptSent(idempotencyKey: string): Promise<void> {
    const docClient = await this.getDocClient();
    const now = Date.now();

    try {
      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          idempotencyKey,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':updatedAt': now,
        },
      });

      await docClient.send(command);

      console.log(`Receipt idempotency record marked as completed: ${idempotencyKey}`);
    } catch (error) {
      console.error('Failed to mark receipt as sent:', error);
      // 領収書送信自体は成功しているので、記録失敗はエラーにしない
    }
  }

  /**
   * 処理を予約（冪等性チェック + レコード作成）
   *
   * 条件付き書き込みにより、同一キーでの重複予約を防止。
   * - キーが存在しない場合: 新規レコードを作成し、処理を開始できる
   * - キーが存在する場合: 既存のレコードを返し、重複処理を防止
   *
   * @param idempotencyKey - 冪等性キー
   * @returns 冪等性チェック結果
   */
  async reserveOrGetExisting(idempotencyKey: string): Promise<IdempotencyCheckResult> {
    const docClient = await this.getDocClient();
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + IdempotencyRepository.TTL_SECONDS;

    const newRecord: IdempotencyRecord = {
      idempotencyKey,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      ttl,
    };

    try {
      // 条件付き書き込み: idempotencyKeyが存在しない場合のみ書き込み
      const command = new PutCommand({
        TableName: this.tableName,
        Item: newRecord,
        ConditionExpression: 'attribute_not_exists(idempotencyKey)',
      });

      await docClient.send(command);

      console.log(`Idempotency key reserved: ${idempotencyKey}`);

      return {
        alreadyProcessed: false,
        inProgress: false,
      };
    } catch (error) {
      // 条件チェック失敗 = 既にレコードが存在する
      if (error instanceof ConditionalCheckFailedException) {
        console.log(`Idempotency key already exists: ${idempotencyKey}`);

        // 既存のレコードを取得
        const existingRecord = await this.getByKey(idempotencyKey);

        if (!existingRecord) {
          // レースコンディションでレコードが消えた場合（TTL等）
          // リトライのため、再度予約を試みる
          console.warn(`Existing record disappeared, retrying reservation: ${idempotencyKey}`);
          return this.reserveOrGetExisting(idempotencyKey);
        }

        return {
          alreadyProcessed: existingRecord.status === 'completed' || existingRecord.status === 'failed',
          inProgress: existingRecord.status === 'processing',
          existingRecord,
        };
      }

      console.error('Failed to reserve idempotency key:', error);
      throw error;
    }
  }

  /**
   * 冪等性レコードを取得
   *
   * @param idempotencyKey - 冪等性キー
   * @returns 冪等性レコード（存在しない場合はnull）
   */
  async getByKey(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const docClient = await this.getDocClient();

    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          idempotencyKey,
        },
      });

      const response = await docClient.send(command);

      if (!response.Item) {
        return null;
      }

      return response.Item as IdempotencyRecord;
    } catch (error) {
      console.error('Failed to get idempotency record:', error);
      throw error;
    }
  }

  /**
   * 処理完了を記録
   *
   * @param idempotencyKey - 冪等性キー
   * @param flowExecutionId - フロー実行ID
   * @param result - 処理結果
   */
  async markCompleted(
    idempotencyKey: string,
    flowExecutionId: string,
    result: PurchaseFlowOutput
  ): Promise<void> {
    const docClient = await this.getDocClient();

    try {
      const now = Date.now();

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          idempotencyKey,
        },
        UpdateExpression: 'SET #status = :status, flowExecutionId = :flowExecutionId, #result = :result, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':flowExecutionId': flowExecutionId,
          ':result': result,
          ':updatedAt': now,
        },
      });

      await docClient.send(command);

      console.log(`Idempotency record marked as completed: ${idempotencyKey}`);
    } catch (error) {
      console.error('Failed to mark idempotency record as completed:', error);
      throw error;
    }
  }

  /**
   * 処理失敗を記録
   *
   * @param idempotencyKey - 冪等性キー
   * @param flowExecutionId - フロー実行ID
   * @param result - 失敗結果
   */
  async markFailed(
    idempotencyKey: string,
    flowExecutionId: string,
    result: PurchaseFlowOutput
  ): Promise<void> {
    const docClient = await this.getDocClient();

    try {
      const now = Date.now();

      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          idempotencyKey,
        },
        UpdateExpression: 'SET #status = :status, flowExecutionId = :flowExecutionId, #result = :result, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':flowExecutionId': flowExecutionId,
          ':result': result,
          ':updatedAt': now,
        },
      });

      await docClient.send(command);

      console.log(`Idempotency record marked as failed: ${idempotencyKey}`);
    } catch (error) {
      console.error('Failed to mark idempotency record as failed:', error);
      throw error;
    }
  }
}
