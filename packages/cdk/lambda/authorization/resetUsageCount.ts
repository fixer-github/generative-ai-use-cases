/**
 * カウントリセットLambda関数
 * Reset Usage Count Lambda Function
 *
 * DynamoDBの利用回数カウンターをゼロにリセットします
 * EventBridge Schedulerから定期的に呼ばれます
 */

import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import { listTenants } from '../tenantManager';
import {
  ResetUsageCountRequest,
  ResetUsageCountResponse,
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

/**
 * 次回リセット日時を計算する
 */
function calculateNextResetTime(
  periodType: 'daily' | 'monthly'
): number {
  const now = new Date();
  let nextReset: Date;

  if (periodType === 'daily') {
    // 翌日の午前0時（UTC）
    nextReset = new Date(now);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    nextReset.setUTCHours(0, 0, 0, 0);
  } else {
    // 翌月1日の午前0時（UTC）
    nextReset = new Date(now);
    nextReset.setUTCMonth(nextReset.getUTCMonth() + 1);
    nextReset.setUTCDate(1);
    nextReset.setUTCHours(0, 0, 0, 0);
  }

  return Math.floor(nextReset.getTime() / 1000);
}

/**
 * 単一テナントのカウンターをリセットする
 */
async function resetTenantCounters(
  tenantId: string,
  periodType: 'daily' | 'monthly',
  environment: string
): Promise<number> {
  try {
    // テナント用のDynamoDBクライアントを作成
    const dynamoDBClient = await createTenantDynamoDBClientForBackgroundJob(
      tenantId
    );

    const usageCounterTableName = getTableName(
      'UsageCounter',
      tenantId,
      environment
    );

    const usageCountRepository = new UsageCountRepository(
      dynamoDBClient,
      usageCounterTableName
    );

    // 現在時刻を取得
    const now = Math.floor(Date.now() / 1000);

    // リセット期限が来たカウンターを取得
    const countersToReset = await usageCountRepository.findByPeriodTypeAndResetTime(
      periodType,
      now
    );

    console.log(
      `Found ${countersToReset.length} counters to reset for tenant ${tenantId}, period ${periodType}`
    );

    // 次回リセット日時を計算
    const nextResetTime = calculateNextResetTime(periodType);

    // 各カウンターをリセット
    for (const counter of countersToReset) {
      await usageCountRepository.reset(
        counter.userId,
        counter.featureIdPeriod,
        nextResetTime
      );

      console.log(
        `Reset counter for user ${counter.userId}, feature ${counter.featureId}, period ${periodType}`
      );
    }

    return countersToReset.length;
  } catch (error) {
    console.error(`Failed to reset counters for tenant ${tenantId}:`, error);
    throw error;
  }
}

export const handler = async (
  event: ResetUsageCountRequest,
  _context: Context
): Promise<ResetUsageCountResponse> => {
  console.log('Reset Usage Count Request:', JSON.stringify(event, null, 2));

  const { periodType } = event;

  try {
    // 1. バリデーション
    if (!periodType) {
      throw new Error('Missing required parameter: periodType');
    }

    if (periodType !== 'daily' && periodType !== 'monthly') {
      throw new Error('periodType must be "daily" or "monthly"');
    }

    const environment = process.env.ENVIRONMENT || 'dev';

    console.log(
      `Starting ${periodType} usage count reset for all tenants in environment: ${environment}`
    );

    // 2. 全テナントのリストを取得
    const tenants = await listTenants();

    console.log(`Found ${tenants.length} tenants to process`);

    // 3. 各テナントのカウンターをリセット
    let totalProcessedTenants = 0;
    let totalUpdatedItems = 0;
    const errors: Array<{ tenantId: string; error: string }> = [];

    for (const tenant of tenants) {
      try {
        const updatedCount = await resetTenantCounters(
          tenant.tenantId,
          periodType,
          environment
        );

        totalProcessedTenants++;
        totalUpdatedItems += updatedCount;

        console.log(
          `Successfully reset ${updatedCount} counters for tenant ${tenant.tenantId}`
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          tenantId: tenant.tenantId,
          error: errorMessage,
        });

        console.error(
          `Failed to reset counters for tenant ${tenant.tenantId}:`,
          error
        );
      }
    }

    // 4. 処理結果をログに記録
    console.log(
      `Reset completed. Processed ${totalProcessedTenants} tenants, updated ${totalUpdatedItems} items, ${errors.length} errors`
    );

    if (errors.length > 0) {
      console.error('Errors during reset:', JSON.stringify(errors, null, 2));
    }

    // 5. 成功レスポンスを返す
    const response: ResetUsageCountResponse = {
      success: true,
      processedTenants: totalProcessedTenants,
      updatedItems: totalUpdatedItems,
      errors,
    };

    console.log(
      'Reset Usage Count Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('Error in resetUsageCount:', error);
    throw error;
  }
};
