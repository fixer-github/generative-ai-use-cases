/**
 * DynamoDB オンデマンドバックアップモジュール
 */

import {
  DynamoDBClient,
  CreateBackupCommand,
  DescribeBackupCommand,
  ListBackupsCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  AWSClientConfig,
  getDynamoDBClient,
  getTenantDynamoDBClient,
} from '../utils/aws';
import {
  DynamoDBBackupResult,
  DiscoveredTable,
  DiscoveredTenant,
} from '../config/types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

/**
 * タイムスタンプを生成
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * バックアップ名を生成
 */
function generateBackupName(tableName: string): string {
  return `${tableName}-migration-${generateTimestamp()}`;
}

/**
 * テーブル情報を取得
 */
export async function describeTable(
  client: DynamoDBClient,
  tableName: string
): Promise<DiscoveredTable | null> {
  try {
    const response = await withRetry(() =>
      client.send(
        new DescribeTableCommand({
          TableName: tableName,
        })
      )
    );

    const table = response.Table;
    if (!table) {
      return null;
    }

    return {
      tableName: table.TableName ?? tableName,
      tableArn: table.TableArn ?? '',
      status: table.TableStatus ?? 'UNKNOWN',
      itemCount: table.ItemCount ?? 0,
      tableSizeBytes: table.TableSizeBytes ?? 0,
      createdAt: table.CreationDateTime ?? new Date(),
      canBackup: table.TableStatus === 'ACTIVE',
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * オンデマンドバックアップを作成
 */
export async function createBackup(
  client: DynamoDBClient,
  tableName: string,
  dryRun: boolean = false
): Promise<DynamoDBBackupResult | null> {
  const backupName = generateBackupName(tableName);

  if (dryRun) {
    logger.dryRun(`バックアップ作成: ${tableName} -> ${backupName}`);
    return {
      tableName,
      backupArn: `arn:aws:dynamodb:region:account:table/${tableName}/backup/${backupName}`,
      backupName,
      backupStatus: 'DRY_RUN',
      createdAt: new Date(),
    };
  }

  logger.processing(`バックアップ作成中: ${tableName}`);

  try {
    const response = await withRetry(() =>
      client.send(
        new CreateBackupCommand({
          TableName: tableName,
          BackupName: backupName,
        })
      )
    );

    const backupDetails = response.BackupDetails;
    if (!backupDetails) {
      throw new Error('バックアップ詳細が取得できませんでした');
    }

    const result: DynamoDBBackupResult = {
      tableName,
      backupArn: backupDetails.BackupArn ?? '',
      backupName: backupDetails.BackupName ?? backupName,
      backupStatus: backupDetails.BackupStatus ?? 'UNKNOWN',
      createdAt: backupDetails.BackupCreationDateTime ?? new Date(),
    };

    logger.success(`バックアップ作成完了: ${backupName}`);
    logger.debug(`  ARN: ${result.backupArn}`);

    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return null;
    }

    if (
      error instanceof Error &&
      error.name === 'ContinuousBackupsUnavailableException'
    ) {
      logger.warn(
        `連続バックアップが有効でないため、オンデマンドバックアップを作成できません: ${tableName}`
      );
      return null;
    }

    logger.error(
      `バックアップ作成失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * デフォルトテナントのテーブルをバックアップ
 */
export async function backupDefaultTenantTables(
  config: AWSClientConfig,
  tableNames: string[],
  dryRun: boolean = false
): Promise<DynamoDBBackupResult[]> {
  const client = getDynamoDBClient(config);
  const results: DynamoDBBackupResult[] = [];

  for (const tableName of tableNames) {
    const result = await createBackup(client, tableName, dryRun);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * テナント固有のテーブルをバックアップ（クロスアカウント対応）
 */
export async function backupTenantTables(
  baseConfig: AWSClientConfig,
  tenant: DiscoveredTenant,
  dryRun: boolean = false
): Promise<DynamoDBBackupResult[]> {
  const results: DynamoDBBackupResult[] = [];

  // クロスアカウントの場合は AssumeRole
  let client: DynamoDBClient;

  if (tenant.roleArn) {
    client = await getTenantDynamoDBClient(
      baseConfig,
      tenant.roleArn,
      tenant.tenantId,
      tenant.region
    );
  } else {
    client = getDynamoDBClient({
      ...baseConfig,
      region: tenant.region,
    });
  }

  const tableNames = [
    tenant.chatHistoryTableName,
    tenant.tokenUsageStatsTableName,
    tenant.useCaseBuilderTableName,
  ];

  for (const tableName of tableNames) {
    try {
      const result = await createBackup(client, tableName, dryRun);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      logger.error(
        `テナント ${tenant.tenantId} のテーブル ${tableName} バックアップ失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return results;
}

/**
 * 既存のバックアップ一覧を取得
 */
export async function listBackups(
  client: DynamoDBClient,
  tableName: string
): Promise<DynamoDBBackupResult[]> {
  const results: DynamoDBBackupResult[] = [];
  let lastEvaluatedBackupArn: string | undefined;

  try {
    do {
      const response = await withRetry(() =>
        client.send(
          new ListBackupsCommand({
            TableName: tableName,
            ExclusiveStartBackupArn: lastEvaluatedBackupArn,
          })
        )
      );

      for (const summary of response.BackupSummaries ?? []) {
        results.push({
          tableName: summary.TableName ?? tableName,
          backupArn: summary.BackupArn ?? '',
          backupName: summary.BackupName ?? '',
          backupStatus: summary.BackupStatus ?? 'UNKNOWN',
          createdAt: summary.BackupCreationDateTime ?? new Date(),
        });
      }

      lastEvaluatedBackupArn = response.LastEvaluatedBackupArn;
    } while (lastEvaluatedBackupArn);
  } catch (error) {
    logger.error(
      `バックアップ一覧取得失敗: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return results;
}

/**
 * バックアップ結果をファイルに保存
 */
export async function saveBackupResults(
  results: DynamoDBBackupResult[],
  outputPath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const data = {
    createdAt: new Date().toISOString(),
    count: results.length,
    backups: results,
  };

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  logger.success(`バックアップ結果を保存: ${outputPath}`);
}

/**
 * バックアップサマリーを表示
 */
export function printBackupSummary(results: DynamoDBBackupResult[]): void {
  const byStatus = new Map<string, number>();

  for (const result of results) {
    byStatus.set(
      result.backupStatus,
      (byStatus.get(result.backupStatus) ?? 0) + 1
    );
  }

  logger.summary('バックアップサマリー', {
    '総数': results.length,
    '作成完了': byStatus.get('AVAILABLE') ?? 0,
    '作成中': byStatus.get('CREATING') ?? 0,
    'ドライラン': byStatus.get('DRY_RUN') ?? 0,
  });
}
