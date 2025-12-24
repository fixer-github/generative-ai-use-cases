/**
 * SystemContext Export
 * ChatHistory テーブルから systemContext プレフィックスのデータを抽出
 */

import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SystemContextBackup, SystemContextData, DiscoveredTenant } from '../config/types';
import {
  AWSClientConfig,
  createDynamoDBDocClient,
  createTenantDynamoDBClient,
  getCallerIdentity,
} from '../utils/aws';
import { isCrossAccountTenant } from '../discovery/tenant';
import * as logger from '../utils/logger';

/**
 * SystemContext のプレフィックス
 */
const SYSTEM_CONTEXT_PREFIX = 'systemContext#';

/**
 * SystemContext データをエクスポートする
 */
export async function exportSystemContexts(
  tableName: string,
  tenantId: string,
  docClient: DynamoDBDocumentClient
): Promise<SystemContextBackup> {
  logger.startProcess(`SystemContext エクスポート (${tenantId})`);

  const items: SystemContextData[] = [];

  try {
    logger.info(`テーブル "${tableName}" から SystemContext を抽出中...`);

    // SystemContext のプレフィックスでクエリ
    // ChatHistory テーブルの構造: id (PK), createdDate (SK)
    // SystemContext の id は 'systemContext#...' で始まる

    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let scanCount = 0;

    do {
      // Scan で systemContext# プレフィックスを持つアイテムをフィルタ
      const response = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'begins_with(id, :prefix)',
          ExpressionAttributeValues: {
            ':prefix': SYSTEM_CONTEXT_PREFIX,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      scanCount++;

      if (response.Items) {
        for (const item of response.Items) {
          const systemContextData: SystemContextData = {
            id: item.id as string,
            createdDate: item.createdDate as string,
            systemContext: item.systemContext as string || '',
            title: item.title as string | undefined,
            ...item,
          };
          items.push(systemContextData);
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey;

      // 進捗をログ出力
      if (scanCount % 10 === 0) {
        logger.debug(`スキャン中... ${items.length} 件の SystemContext を検出`);
      }
    } while (lastEvaluatedKey);

    const backup: SystemContextBackup = {
      tenantId,
      tableName,
      exportedAt: new Date().toISOString(),
      itemCount: items.length,
      items,
    };

    logger.success(`${items.length} 件の SystemContext をエクスポートしました`);
    logger.endProcess(`SystemContext エクスポート (${tenantId})`);

    return backup;
  } catch (error) {
    logger.failProcess(`SystemContext エクスポート (${tenantId})`, error);
    throw error;
  }
}

/**
 * デフォルトテナントの SystemContext をエクスポートする
 */
export async function exportDefaultTenantSystemContexts(
  tableName: string,
  config: AWSClientConfig
): Promise<SystemContextBackup> {
  const docClient = createDynamoDBDocClient(config);
  return exportSystemContexts(tableName, 'default', docClient);
}

/**
 * テナントの SystemContext をエクスポートする
 * クロスアカウントテナントの場合は AssumeRole を使用
 */
export async function exportTenantSystemContexts(
  tenant: DiscoveredTenant,
  config: AWSClientConfig
): Promise<SystemContextBackup> {
  // 現在のアカウントIDを取得
  const { accountId: currentAccountId } = await getCallerIdentity(config);

  let docClient: DynamoDBDocumentClient;

  if (isCrossAccountTenant(tenant, currentAccountId)) {
    // クロスアカウントテナントの場合は AssumeRole
    logger.info(`クロスアカウントテナント "${tenant.tenantId}" のロールをAssume中...`);
    docClient = await createTenantDynamoDBClient(
      tenant.roleArn,
      tenant.region,
      `migration-${tenant.tenantId}`,
      config
    );
  } else {
    // 同一アカウントの場合は通常のクライアント
    docClient = createDynamoDBDocClient({
      ...config,
      region: tenant.region,
    });
  }

  return exportSystemContexts(
    tenant.chatHistoryTableName,
    tenant.tenantId,
    docClient
  );
}

/**
 * SystemContext バックアップのサマリーを取得する
 */
export function getSystemContextBackupSummary(
  backup: SystemContextBackup
): {
  tenantId: string;
  itemCount: number;
  uniqueTitles: number;
  exportedAt: string;
} {
  const uniqueTitles = new Set(
    backup.items.filter((item) => item.title).map((item) => item.title)
  ).size;

  return {
    tenantId: backup.tenantId,
    itemCount: backup.itemCount,
    uniqueTitles,
    exportedAt: backup.exportedAt,
  };
}

/**
 * SystemContext のカテゴリ別カウントを取得する
 */
export function categorizeSystemContexts(
  backup: SystemContextBackup
): Map<string, number> {
  const categories = new Map<string, number>();

  for (const item of backup.items) {
    // id から カテゴリを抽出 (systemContext#category#... 形式の場合)
    const idParts = item.id.replace(SYSTEM_CONTEXT_PREFIX, '').split('#');
    const category = idParts[0] || 'uncategorized';

    const count = categories.get(category) || 0;
    categories.set(category, count + 1);
  }

  return categories;
}
