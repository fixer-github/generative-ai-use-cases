/**
 * DynamoDB Backup
 * DynamoDB オンデマンドバックアップの作成
 */

import {
  DynamoDBClient,
  CreateBackupCommand,
  DescribeBackupCommand,
  ListBackupsCommand,
  BackupStatus,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBBackupResult, DiscoveredTenant, TableInfo } from '../config/types';
import {
  AWSClientConfig,
  createDynamoDBClient,
  assumeTenantRole,
} from '../utils/aws';
import { isCrossAccountTenant } from '../discovery/tenant';
import * as logger from '../utils/logger';
import { withRetry, sleep } from '../utils/progress';

/**
 * バックアップ名を生成する
 * フォーマット: {tableName}-migration-{timestamp}
 */
function generateBackupName(tableName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${tableName}-migration-${timestamp}`;
}

/**
 * DynamoDB テーブルの情報を取得する
 */
export async function getTableInfo(
  tableName: string,
  client: DynamoDBClient
): Promise<TableInfo> {
  logger.debug(`テーブル "${tableName}" の情報を取得中...`);

  const response = await client.send(
    new DescribeTableCommand({
      TableName: tableName,
    })
  );

  const table = response.Table;
  if (!table) {
    throw new Error(`テーブル "${tableName}" が見つかりません`);
  }

  return {
    tableName: table.TableName || tableName,
    tableArn: table.TableArn || '',
    tableStatus: table.TableStatus || 'UNKNOWN',
    itemCount: table.ItemCount || 0,
    tableSizeBytes: table.TableSizeBytes || 0,
    createdAt: table.CreationDateTime?.toISOString() || '',
  };
}

/**
 * DynamoDB オンデマンドバックアップを作成する
 */
export async function createBackup(
  tableName: string,
  client: DynamoDBClient,
  dryRun: boolean = false
): Promise<DynamoDBBackupResult> {
  const backupName = generateBackupName(tableName);

  logger.info(`テーブル "${tableName}" のバックアップを作成中...`);
  logger.debug(`バックアップ名: ${backupName}`);

  if (dryRun) {
    logger.info(`[ドライラン] バックアップ "${backupName}" は作成されません`);
    return {
      tableName,
      backupArn: `arn:aws:dynamodb:region:account:table/${tableName}/backup/${backupName}`,
      backupName,
      backupStatus: 'DRY_RUN',
      createdAt: new Date().toISOString(),
    };
  }

  try {
    const response = await withRetry(
      async () =>
        client.send(
          new CreateBackupCommand({
            TableName: tableName,
            BackupName: backupName,
          })
        ),
      {
        maxRetries: 3,
        delayMs: 2000,
        onRetry: (attempt, error) => {
          logger.warn(`バックアップ作成リトライ (${attempt}/3): ${error}`);
        },
      }
    );

    const backupDetails = response.BackupDetails;
    if (!backupDetails) {
      throw new Error('バックアップの詳細が取得できませんでした');
    }

    const result: DynamoDBBackupResult = {
      tableName,
      backupArn: backupDetails.BackupArn || '',
      backupName: backupDetails.BackupName || backupName,
      backupStatus: backupDetails.BackupStatus || 'UNKNOWN',
      createdAt: backupDetails.BackupCreationDateTime?.toISOString() || new Date().toISOString(),
    };

    logger.success(`バックアップ "${result.backupName}" を作成しました (${result.backupStatus})`);

    return result;
  } catch (error) {
    logger.error(`テーブル "${tableName}" のバックアップ作成に失敗しました:`, error);
    throw error;
  }
}

/**
 * バックアップの完了を待機する
 */
export async function waitForBackupCompletion(
  backupArn: string,
  client: DynamoDBClient,
  timeoutMs: number = 300000 // 5分
): Promise<DynamoDBBackupResult> {
  logger.info(`バックアップの完了を待機中... (タイムアウト: ${timeoutMs / 1000}秒)`);

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await client.send(
      new DescribeBackupCommand({
        BackupArn: backupArn,
      })
    );

    const backupDescription = response.BackupDescription;
    if (!backupDescription) {
      throw new Error('バックアップの詳細が取得できませんでした');
    }

    const status = backupDescription.BackupDetails?.BackupStatus;

    if (status === BackupStatus.AVAILABLE) {
      logger.success('バックアップが完了しました');
      return {
        tableName: backupDescription.SourceTableDetails?.TableName || '',
        backupArn,
        backupName: backupDescription.BackupDetails?.BackupName || '',
        backupStatus: status,
        createdAt: backupDescription.BackupDetails?.BackupCreationDateTime?.toISOString() || '',
      };
    }

    if (status === BackupStatus.DELETED) {
      throw new Error('バックアップが削除されました');
    }

    logger.debug(`バックアップステータス: ${status}, 待機中...`);
    await sleep(5000); // 5秒待機
  }

  throw new Error(`バックアップがタイムアウトしました (${timeoutMs / 1000}秒)`);
}

/**
 * デフォルトテナントのテーブルをバックアップする
 */
export async function backupDefaultTenantTables(
  tableNames: string[],
  config: AWSClientConfig,
  dryRun: boolean = false
): Promise<DynamoDBBackupResult[]> {
  logger.startProcess('デフォルトテナントバックアップ');

  const client = createDynamoDBClient(config);
  const results: DynamoDBBackupResult[] = [];

  for (const tableName of tableNames) {
    if (!tableName) {
      logger.warn('テーブル名が空のためスキップします');
      continue;
    }

    try {
      const result = await createBackup(tableName, client, dryRun);
      results.push(result);
    } catch (error) {
      logger.error(`テーブル "${tableName}" のバックアップに失敗しました:`, error);
      // エラーを収集して続行
      results.push({
        tableName,
        backupArn: '',
        backupName: '',
        backupStatus: 'FAILED',
        createdAt: new Date().toISOString(),
      });
    }
  }

  logger.endProcess('デフォルトテナントバックアップ');
  return results;
}

/**
 * テナントのテーブルをバックアップする
 */
export async function backupTenantTables(
  tenant: DiscoveredTenant,
  config: AWSClientConfig,
  dryRun: boolean = false
): Promise<DynamoDBBackupResult[]> {
  logger.startProcess(`テナント "${tenant.tenantId}" バックアップ`);

  let client: DynamoDBClient;

  if (isCrossAccountTenant(tenant)) {
    // クロスアカウントテナントの場合は AssumeRole
    logger.info(`クロスアカウントテナント "${tenant.tenantId}" のロールをAssume中...`);
    const credentials = await assumeTenantRole(
      tenant.roleArn,
      `migration-backup-${tenant.tenantId}`,
      config
    );

    client = new DynamoDBClient({
      region: tenant.region,
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken,
      },
    });
  } else {
    // 同一アカウントの場合
    client = createDynamoDBClient({
      ...config,
      region: tenant.region,
    });
  }

  const tableNames = [
    tenant.chatHistoryTableName,
    tenant.tokenUsageStatsTableName,
    tenant.useCaseBuilderTableName,
    tenant.assistantTableName,
  ].filter((name) => name && name.trim() !== '');

  const results: DynamoDBBackupResult[] = [];

  for (const tableName of tableNames) {
    try {
      // テーブルが存在するか確認
      await getTableInfo(tableName, client);

      const result = await createBackup(tableName, client, dryRun);
      results.push(result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tableName}" が存在しないためスキップします`);
      } else {
        logger.error(`テーブル "${tableName}" のバックアップに失敗しました:`, error);
        results.push({
          tableName,
          backupArn: '',
          backupName: '',
          backupStatus: 'FAILED',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  logger.endProcess(`テナント "${tenant.tenantId}" バックアップ`);
  return results;
}

/**
 * 既存のバックアップを一覧する
 */
export async function listBackups(
  tableName: string,
  client: DynamoDBClient
): Promise<DynamoDBBackupResult[]> {
  const response = await client.send(
    new ListBackupsCommand({
      TableName: tableName,
    })
  );

  const backups = response.BackupSummaries || [];

  return backups.map((backup) => ({
    tableName: backup.TableName || tableName,
    backupArn: backup.BackupArn || '',
    backupName: backup.BackupName || '',
    backupStatus: backup.BackupStatus || 'UNKNOWN',
    createdAt: backup.BackupCreationDateTime?.toISOString() || '',
  }));
}
