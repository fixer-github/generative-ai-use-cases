/**
 * カウント加算Lambda関数
 * Increment Usage Count Lambda Function
 *
 * DynamoDBの利用回数カウンターを1増やします
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import {
  IncrementUsageCountRequest,
  IncrementUsageCountResponse,
} from './repositories/types';
import { UsageCountRepository } from './repositories/usageCountRepository';

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
  console.log('Increment Usage Count Request:', JSON.stringify(event, null, 2));

  const { tenantId, userId, featureId, periodType } = event;

  try {
    // 1. バリデーション
    if (!tenantId || !userId || !featureId || !periodType) {
      throw new Error(
        'Missing required parameters: tenantId, userId, featureId, periodType'
      );
    }

    if (periodType !== 'daily' && periodType !== 'monthly') {
      throw new Error('periodType must be "daily" or "monthly"');
    }

    // 2. DynamoDBのカウンターをアトミックに更新
    const dynamoDBClient =
      await createTenantDynamoDBClientForBackgroundJob(tenantId);

    const usageCounterTableName = getTableName(
      'AuthUsageCounter',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageCountRepository = new UsageCountRepository(
      dynamoDBClient,
      usageCounterTableName
    );

    const featureIdPeriod = `${featureId}#${periodType}`;

    const newCount = await usageCountRepository.increment(
      userId,
      featureIdPeriod
    );

    console.log(
      `Incremented usage count for user ${userId}, feature ${featureId}, period ${periodType}. New count: ${newCount}`
    );

    // 3. 成功レスポンスを返す
    const response: IncrementUsageCountResponse = {
      success: true,
      newCount,
    };

    console.log(
      'Increment Usage Count Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('Error in incrementUsageCount:', error);
    throw error;
  }
};
