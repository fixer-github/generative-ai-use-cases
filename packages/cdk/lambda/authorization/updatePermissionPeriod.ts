/**
 * 権限期間更新Lambda関数
 * Update Permission Period Lambda Function
 *
 * 既存のPermissionGrantの請求期間を更新します
 * 同一プラン・同一ソースで期間のみが変更された場合に使用
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import { getTenant } from '../tenantManager';
import { PermissionGrantRepository } from './repositories/permissionGrantRepository';

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
 * 期間更新リクエスト
 */
export interface UpdatePermissionPeriodRequest {
  tenantId: string;
  sourceId: string; // application_id
  periodStart: number; // Unixタイムスタンプ（秒単位）
  periodEnd: number; // Unixタイムスタンプ（秒単位）
}

/**
 * 期間更新レスポンス
 */
export interface UpdatePermissionPeriodResponse {
  success: boolean;
  grantId?: string;
  error?: string;
}

export const handler = async (
  event: UpdatePermissionPeriodRequest,
  _context: Context
): Promise<UpdatePermissionPeriodResponse> => {
  console.log(
    'Update Permission Period Request:',
    JSON.stringify(event, null, 2)
  );

  const { tenantId, sourceId, periodStart, periodEnd } = event;

  try {
    // 1. バリデーション
    if (!tenantId || !sourceId) {
      throw new Error('Missing required parameters: tenantId, sourceId');
    }

    if (periodStart === undefined || periodStart === null) {
      throw new Error('periodStart is required');
    }

    if (periodEnd === undefined || periodEnd === null) {
      throw new Error('periodEnd is required');
    }

    if (periodEnd <= periodStart) {
      throw new Error('periodEnd must be after periodStart');
    }

    // 2. テナント情報の取得
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // 3. DynamoDBクライアントを作成
    const dynamoDBClient =
      await createTenantDynamoDBClientForBackgroundJob(tenantId);

    const permissionGrantTableName = getTableName(
      'AuthPermissionGrant',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const permissionGrantRepository = new PermissionGrantRepository(
      dynamoDBClient,
      permissionGrantTableName
    );

    // 4. sourceIdからPermissionGrantを検索
    const existingGrant = await permissionGrantRepository.findBySourceId(sourceId);

    if (!existingGrant) {
      console.log(`No active permission grant found for sourceId: ${sourceId}`);
      return {
        success: false,
        error: `No active permission grant found for sourceId: ${sourceId}`,
      };
    }

    // 5. 期間を更新
    console.log(
      `[UpdatePermissionPeriod] Updating period - grantId: ${existingGrant.grantId}, periodStart: ${periodStart}, periodEnd: ${periodEnd}`
    );

    await permissionGrantRepository.updatePeriod(
      existingGrant.grantId,
      periodStart,
      periodEnd
    );

    console.log(
      `[UpdatePermissionPeriod] Permission period updated successfully - grantId: ${existingGrant.grantId}`
    );

    // 6. 成功レスポンスを返す
    return {
      success: true,
      grantId: existingGrant.grantId,
    };
  } catch (error) {
    console.error('Error in updatePermissionPeriod:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
