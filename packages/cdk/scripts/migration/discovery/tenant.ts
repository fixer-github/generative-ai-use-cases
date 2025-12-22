/**
 * テナント検出モジュール
 * Tenants テーブルからテナント一覧を取得
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  getDynamoDBDocumentClient,
  generateTenantTableName,
} from '../utils/aws';
import { DiscoveredTenant, TenantStatus, AWSClientConfig } from '../config/types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

/**
 * Tenants テーブルからテナント一覧を取得
 */
export async function discoverTenants(
  config: AWSClientConfig,
  tenantsTableName: string,
  environment: string
): Promise<DiscoveredTenant[]> {
  logger.info(`テナントを検出中: ${tenantsTableName}`);

  const docClient = getDynamoDBDocumentClient(config);
  const tenants: DiscoveredTenant[] = [];

  try {
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tenantsTableName,
            ExclusiveStartKey: lastEvaluatedKey,
          })
        )
      );

      for (const item of response.Items ?? []) {
        const tenantId = item.tenantId as string;

        if (!tenantId) {
          logger.warn('tenantId が見つからないレコードをスキップ');
          continue;
        }

        const tenant: DiscoveredTenant = {
          tenantId,
          status: (item.status as TenantStatus) ?? TenantStatus.ACTIVE,
          region: (item.region as string) ?? config.region,
          environment: (item.environment as string) ?? environment,
          accountId: (item.accountId as string) ?? '',
          roleArn: (item.roleArn as string) ?? '',
          createdAt: (item.createdAt as string) ?? '',
          updatedAt: (item.updatedAt as string) ?? '',
          chatHistoryTableName: generateTenantTableName(
            'ChatHistory',
            environment,
            tenantId
          ),
          tokenUsageStatsTableName: generateTenantTableName(
            'TokenUsageStats',
            environment,
            tenantId
          ),
          useCaseBuilderTableName: generateTenantTableName(
            'UseCaseBuilder',
            environment,
            tenantId
          ),
          metadata: item.metadata as Record<string, unknown>,
        };

        tenants.push(tenant);

        logger.debug(
          `テナント検出: ${tenantId} (${tenant.status}, ${tenant.region})`
        );
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    logger.success(`${tenants.length} 件のテナントを検出`);
  } catch (error) {
    // テーブルが存在しない場合
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(
        `テナントテーブルが見つかりません: ${tenantsTableName}`
      );
      return [];
    }

    logger.error(
      `テナント検出中にエラー: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  return tenants;
}

/**
 * アクティブなテナントのみをフィルタリング
 */
export function filterActiveTenants(
  tenants: DiscoveredTenant[]
): DiscoveredTenant[] {
  return tenants.filter((t) => t.status === TenantStatus.ACTIVE);
}

/**
 * 除外リストに基づいてテナントをフィルタリング
 */
export function excludeTenants(
  tenants: DiscoveredTenant[],
  excludeList: string[]
): DiscoveredTenant[] {
  const excludeSet = new Set(excludeList.map((id) => id.toLowerCase()));
  return tenants.filter(
    (t) => !excludeSet.has(t.tenantId.toLowerCase())
  );
}

/**
 * テナント情報をグループ化（アカウントID別）
 */
export function groupTenantsByAccount(
  tenants: DiscoveredTenant[]
): Map<string, DiscoveredTenant[]> {
  const grouped = new Map<string, DiscoveredTenant[]>();

  for (const tenant of tenants) {
    const accountId = tenant.accountId || 'unknown';
    if (!grouped.has(accountId)) {
      grouped.set(accountId, []);
    }
    grouped.get(accountId)!.push(tenant);
  }

  return grouped;
}

/**
 * テナント情報をファイルに保存
 */
export async function saveTenantsToFile(
  tenants: DiscoveredTenant[],
  outputPath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const data = {
    discoveredAt: new Date().toISOString(),
    count: tenants.length,
    tenants,
    summary: {
      byStatus: Object.fromEntries(
        Object.values(TenantStatus).map((status) => [
          status,
          tenants.filter((t) => t.status === status).length,
        ])
      ),
      byRegion: Object.fromEntries(
        Array.from(new Set(tenants.map((t) => t.region))).map((region) => [
          region,
          tenants.filter((t) => t.region === region).length,
        ])
      ),
      byAccount: Object.fromEntries(
        Array.from(groupTenantsByAccount(tenants).entries()).map(
          ([accountId, list]) => [accountId, list.length]
        )
      ),
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  logger.success(`テナント情報を保存: ${outputPath}`);
}

/**
 * テナントのサマリーを表示
 */
export function printTenantSummary(tenants: DiscoveredTenant[]): void {
  const byStatus = new Map<TenantStatus, number>();
  const byRegion = new Map<string, number>();

  for (const tenant of tenants) {
    byStatus.set(tenant.status, (byStatus.get(tenant.status) ?? 0) + 1);
    byRegion.set(tenant.region, (byRegion.get(tenant.region) ?? 0) + 1);
  }

  logger.summary('テナントサマリー', {
    '総数': tenants.length,
    'アクティブ': byStatus.get(TenantStatus.ACTIVE) ?? 0,
    '非アクティブ': byStatus.get(TenantStatus.INACTIVE) ?? 0,
    'プロビジョニング中': byStatus.get(TenantStatus.PROVISIONING) ?? 0,
    'エラー': byStatus.get(TenantStatus.ERROR) ?? 0,
  });

  if (byRegion.size > 1) {
    logger.info('リージョン別:');
    Array.from(byRegion.entries()).forEach(([region, count]) => {
      logger.info(`  ${region}: ${count} 件`);
    });
  }
}
