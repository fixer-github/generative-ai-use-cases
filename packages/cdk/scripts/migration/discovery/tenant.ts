/**
 * Tenant Discovery
 * Tenants テーブルからテナント一覧を取得
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DiscoveredTenant, DiscoveredEnvironment } from '../config/types';
import { AWSClientConfig, createDynamoDBDocClient } from '../utils/aws';
import * as logger from '../utils/logger';

/**
 * テナント固有のテーブル名を生成する
 * パターン: {baseTableName}-{environment}-tenant-{sanitizedTenantId}
 */
function generateTenantTableName(
  baseTableName: string,
  tenantId: string,
  environment: string
): string {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${baseTableName}-${environment}-tenant-${sanitizedTenantId}`;
}

/**
 * Tenants テーブルからテナント一覧を取得する
 */
export async function discoverTenants(
  tenantsTableName: string,
  environment: DiscoveredEnvironment,
  config: AWSClientConfig,
  excludeTenants: string[] = []
): Promise<DiscoveredTenant[]> {
  logger.startProcess(`テナント検出 (${environment.name})`);

  const tenants: DiscoveredTenant[] = [];

  try {
    const docClient = createDynamoDBDocClient(config);

    // Tenants テーブルをスキャン
    logger.info(`Tenants テーブル "${tenantsTableName}" をスキャン中...`);

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const response = await docClient.send(
        new ScanCommand({
          TableName: tenantsTableName,
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const tenantId = item.tenantId as string;

          // 除外リストに含まれるテナントはスキップ
          if (excludeTenants.includes(tenantId)) {
            logger.debug(`テナント "${tenantId}" は除外リストに含まれているためスキップします`);
            continue;
          }

          const tenant: DiscoveredTenant = {
            tenantId,
            status: item.status as string || 'unknown',
            region: item.region as string || config.region,
            environment: item.environment as string || environment.name,
            accountId: item.accountId as string || '',
            roleArn: item.roleArn as string || '',
            createdAt: item.createdAt as string || '',
            updatedAt: item.updatedAt as string || '',
            metadata: item.metadata as Record<string, unknown> | undefined,
            chatHistoryTableName: generateTenantTableName(
              'ChatHistory',
              tenantId,
              item.environment as string || environment.name
            ),
            tokenUsageStatsTableName: generateTenantTableName(
              'TokenUsageStats',
              tenantId,
              item.environment as string || environment.name
            ),
            useCaseBuilderTableName: generateTenantTableName(
              'UseCaseBuilder',
              tenantId,
              item.environment as string || environment.name
            ),
            assistantTableName: generateTenantTableName(
              'Assistant',
              tenantId,
              item.environment as string || environment.name
            ),
          };

          tenants.push(tenant);

          logger.debug(`テナント "${tenantId}" を検出しました (${tenant.status})`);
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    logger.success(`${tenants.length} 個のテナントを検出しました`);
    logger.endProcess(`テナント検出 (${environment.name})`);

    return tenants;
  } catch (error) {
    logger.failProcess(`テナント検出 (${environment.name})`, error);
    throw error;
  }
}

/**
 * 特定のテナントを検出する
 */
export async function discoverTenantById(
  tenantId: string,
  tenantsTableName: string,
  environment: DiscoveredEnvironment,
  config: AWSClientConfig
): Promise<DiscoveredTenant | null> {
  logger.info(`テナント "${tenantId}" を検索中...`);

  try {
    const docClient = createDynamoDBDocClient(config);

    // GetItem を使用して特定のテナントを取得
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const response = await docClient.send(
      new GetCommand({
        TableName: tenantsTableName,
        Key: { tenantId },
      })
    );

    if (!response.Item) {
      logger.warn(`テナント "${tenantId}" が見つかりませんでした`);
      return null;
    }

    const item = response.Item;
    const tenant: DiscoveredTenant = {
      tenantId,
      status: item.status as string || 'unknown',
      region: item.region as string || config.region,
      environment: item.environment as string || environment.name,
      accountId: item.accountId as string || '',
      roleArn: item.roleArn as string || '',
      createdAt: item.createdAt as string || '',
      updatedAt: item.updatedAt as string || '',
      metadata: item.metadata as Record<string, unknown> | undefined,
      chatHistoryTableName: generateTenantTableName(
        'ChatHistory',
        tenantId,
        item.environment as string || environment.name
      ),
      tokenUsageStatsTableName: generateTenantTableName(
        'TokenUsageStats',
        tenantId,
        item.environment as string || environment.name
      ),
      useCaseBuilderTableName: generateTenantTableName(
        'UseCaseBuilder',
        tenantId,
        item.environment as string || environment.name
      ),
      assistantTableName: generateTenantTableName(
        'Assistant',
        tenantId,
        item.environment as string || environment.name
      ),
    };

    logger.success(`テナント "${tenantId}" を検出しました`);
    return tenant;
  } catch (error) {
    logger.error(`テナント "${tenantId}" の検索に失敗しました:`, error);
    return null;
  }
}

/**
 * デフォルトテナントの情報を作成する
 * (マルチテナントが有効でない環境用)
 */
export function createDefaultTenant(
  environment: DiscoveredEnvironment
): DiscoveredTenant {
  return {
    tenantId: 'default',
    status: 'active',
    region: environment.region,
    environment: environment.name,
    accountId: '',
    roleArn: '',
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
    chatHistoryTableName: environment.chatHistoryTableName || '',
    tokenUsageStatsTableName: environment.tokenUsageStatsTableName || '',
    useCaseBuilderTableName: environment.useCaseBuilderTableName || '',
    assistantTableName: '',
  };
}

/**
 * テナントがクロスアカウントかどうかを判定する
 */
export function isCrossAccountTenant(tenant: DiscoveredTenant): boolean {
  return !!tenant.roleArn && tenant.roleArn.trim() !== '';
}

/**
 * テナントがアクティブかどうかを判定する
 */
export function isActiveTenant(tenant: DiscoveredTenant): boolean {
  return tenant.status === 'active';
}

/**
 * 検出結果を表示用にフォーマットする
 */
export function formatTenantSummary(tenants: DiscoveredTenant[]): string {
  if (tenants.length === 0) {
    return '検出されたテナントはありません';
  }

  const lines: string[] = [
    '検出されたテナント:',
    '',
    '| テナントID | 環境 | リージョン | ステータス | アカウントID | クロスアカウント |',
    '|------------|------|------------|-----------|--------------|------------------|',
  ];

  for (const tenant of tenants) {
    const crossAccount = isCrossAccountTenant(tenant) ? 'Yes' : 'No';
    const accountId = tenant.accountId || '(同一アカウント)';
    lines.push(
      `| ${tenant.tenantId} | ${tenant.environment} | ${tenant.region} | ${tenant.status} | ${accountId} | ${crossAccount} |`
    );
  }

  return lines.join('\n');
}

/**
 * テナントをステータスでグループ化する
 */
export function groupTenantsByStatus(
  tenants: DiscoveredTenant[]
): Map<string, DiscoveredTenant[]> {
  const grouped = new Map<string, DiscoveredTenant[]>();

  for (const tenant of tenants) {
    const status = tenant.status || 'unknown';
    if (!grouped.has(status)) {
      grouped.set(status, []);
    }
    grouped.get(status)!.push(tenant);
  }

  return grouped;
}

/**
 * テナントを環境でグループ化する
 */
export function groupTenantsByEnvironment(
  tenants: DiscoveredTenant[]
): Map<string, DiscoveredTenant[]> {
  const grouped = new Map<string, DiscoveredTenant[]>();

  for (const tenant of tenants) {
    const env = tenant.environment || 'unknown';
    if (!grouped.has(env)) {
      grouped.set(env, []);
    }
    grouped.get(env)!.push(tenant);
  }

  return grouped;
}
