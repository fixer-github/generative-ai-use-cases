/**
 * 使用イベント記録Lambda関数
 * Record Usage Event Lambda Function
 *
 * ユーザの機能使用イベントをDynamoDBに記録します
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import {
  IncrementUsageCountRequest,
  IncrementUsageCountResponse,
} from './repositories/types';
import { UsageEventRepository } from './repositories/usageEventRepository';

/**
 * テーブル名を生成するヘルパー関数
 */
function getTableName(
  baseTableName: string,
  tenantId: string,
  environment: string
): string {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${baseTableName}-${environment}-tenant-${sanitizedTenantId}`;
}

export const handler = async (
  event: IncrementUsageCountRequest,
  _context: Context
): Promise<IncrementUsageCountResponse> => {
  console.log(
    '[RecordUsageEvent] Request received:',
    JSON.stringify(event, null, 2)
  );

  const { tenantId, userId, featureId } = event;

  try {
    // 1. バリデーション
    if (!tenantId || !userId || !featureId) {
      console.error('[RecordUsageEvent] Missing required parameters:', {
        tenantId,
        userId,
        featureId,
      });
      throw new Error(
        'Missing required parameters: tenantId, userId, featureId'
      );
    }

    console.log(
      `[RecordUsageEvent] Processing event - tenantId: ${tenantId}, userId: ${userId}, featureId: ${featureId}`
    );

    // 2. DynamoDBに使用イベントを記録
    const dynamoDBClient =
      await createTenantDynamoDBClientForBackgroundJob(tenantId);

    const usageEventTableName = getTableName(
      'AuthUsageEvent',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    console.log(`[RecordUsageEvent] Using table: ${usageEventTableName}`);

    const usageEventRepository = new UsageEventRepository(
      dynamoDBClient,
      usageEventTableName
    );

    const now = Date.now();
    const ttl = Math.floor(now / 1000) + 120 * 24 * 60 * 60; // 120日後（秒単位）

    await usageEventRepository.recordEvent({
      userId,
      timestamp: now,
      featureId,
      ttl,
    });

    console.log(
      `[RecordUsageEvent] Successfully recorded event - user: ${userId}, feature: ${featureId}, timestamp: ${now}`
    );

    // 3. 成功レスポンスを返す
    const response: IncrementUsageCountResponse = {
      success: true,
      timestamp: now,
    };

    console.log(
      '[RecordUsageEvent] Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('[RecordUsageEvent] Error occurred:', error);
    throw error;
  }
};
