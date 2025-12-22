/**
 * SystemContext エクスポートモジュール
 * ChatHistory テーブルから systemContext# プレフィックスのデータを抽出
 */

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  AWSClientConfig,
  getDynamoDBDocumentClient,
  getTenantDynamoDBDocumentClient,
} from '../utils/aws';
import {
  SystemContextBackup,
  SystemContextBackupItem,
  DiscoveredTenant,
} from '../config/types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

/**
 * SystemContext データを抽出（Scan版）
 * id が 'systemContext#' で始まるレコードを全て取得
 */
export async function exportSystemContexts(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  environment: string
): Promise<SystemContextBackup> {
  logger.processing(`SystemContext エクスポート: ${tableName}`);

  const items: SystemContextBackupItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let scannedCount = 0;

  try {
    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'begins_with(id, :prefix)',
            ExpressionAttributeValues: {
              ':prefix': 'systemContext#',
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        )
      );

      scannedCount += response.ScannedCount ?? 0;

      for (const item of response.Items ?? []) {
        items.push({
          id: item.id as string,
          createdDate: item.createdDate as string,
          systemContextId: item.systemContextId as string,
          systemContext: item.systemContext as string,
          systemContextTitle: item.systemContextTitle as string,
        });
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    logger.success(
      `SystemContext エクスポート完了: ${items.length} 件 (スキャン: ${scannedCount} 件)`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return {
        tenantId,
        environment,
        tableName,
        exportedAt: new Date().toISOString(),
        itemCount: 0,
        items: [],
      };
    }

    logger.error(
      `SystemContext エクスポート失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  return {
    tenantId,
    environment,
    tableName,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

/**
 * デフォルトテナントの SystemContext をエクスポート
 */
export async function exportDefaultTenantSystemContexts(
  config: AWSClientConfig,
  tableName: string,
  environment: string
): Promise<SystemContextBackup> {
  const docClient = getDynamoDBDocumentClient(config);
  return exportSystemContexts(docClient, tableName, 'default', environment);
}

/**
 * テナント固有の SystemContext をエクスポート（クロスアカウント対応）
 */
export async function exportTenantSystemContexts(
  baseConfig: AWSClientConfig,
  tenant: DiscoveredTenant
): Promise<SystemContextBackup> {
  // クロスアカウントの場合は AssumeRole
  if (tenant.roleArn) {
    const docClient = await getTenantDynamoDBDocumentClient(
      baseConfig,
      tenant.roleArn,
      tenant.tenantId,
      tenant.region
    );

    return exportSystemContexts(
      docClient,
      tenant.chatHistoryTableName,
      tenant.tenantId,
      tenant.environment
    );
  }

  // 同一アカウントの場合
  const docClient = getDynamoDBDocumentClient({
    ...baseConfig,
    region: tenant.region,
  });

  return exportSystemContexts(
    docClient,
    tenant.chatHistoryTableName,
    tenant.tenantId,
    tenant.environment
  );
}

/**
 * SystemContext バックアップをファイルに保存
 */
export async function saveSystemContextBackup(
  backup: SystemContextBackup,
  outputPath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(backup, null, 2), 'utf-8');

  logger.success(`SystemContext バックアップを保存: ${outputPath}`);
}

/**
 * ユーザー別に SystemContext を集計
 */
export function aggregateByUser(
  backup: SystemContextBackup
): Map<string, SystemContextBackupItem[]> {
  const byUser = new Map<string, SystemContextBackupItem[]>();

  for (const item of backup.items) {
    // id: systemContext#userId から userId を抽出
    const userId = item.id.replace('systemContext#', '');

    if (!byUser.has(userId)) {
      byUser.set(userId, []);
    }
    byUser.get(userId)!.push(item);
  }

  return byUser;
}

/**
 * SystemContext サマリーを表示
 */
export function printSystemContextSummary(backup: SystemContextBackup): void {
  const byUser = aggregateByUser(backup);

  logger.summary(`SystemContext サマリー (${backup.tenantId})`, {
    'テーブル': backup.tableName,
    '総数': backup.itemCount,
    'ユーザー数': byUser.size,
    'エクスポート日時': backup.exportedAt,
  });

  if (byUser.size > 0 && byUser.size <= 10) {
    logger.info('ユーザー別:');
    Array.from(byUser.entries()).forEach(([userId, items]) => {
      logger.info(`  ${userId}: ${items.length} 件`);
    });
  }
}
