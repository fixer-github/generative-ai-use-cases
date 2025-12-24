/**
 * JSON Export
 * テーブルデータのJSON形式でのエクスポート
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BackupManifest,
  DiscoveredTenant,
  DynamoDBBackupResult,
  SystemContextBackup,
} from '../config/types';
import {
  AWSClientConfig,
  createDynamoDBDocClient,
  assumeTenantRole,
  getCallerIdentity,
} from '../utils/aws';
import { isCrossAccountTenant } from '../discovery/tenant';
import * as logger from '../utils/logger';
import { ProgressBar } from '../utils/progress';

/**
 * テーブルデータをJSON形式でエクスポートする
 */
export async function exportTableToJson(
  tableName: string,
  docClient: DynamoDBDocumentClient,
  outputPath: string,
  filterPrefix?: string
): Promise<{ itemCount: number; filePath: string }> {
  logger.info(`テーブル "${tableName}" をエクスポート中...`);

  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let scanCount = 0;

  const scanParams: {
    TableName: string;
    ExclusiveStartKey?: Record<string, unknown>;
    FilterExpression?: string;
    ExpressionAttributeValues?: Record<string, string>;
  } = {
    TableName: tableName,
  };

  // プレフィックスフィルタが指定されている場合
  if (filterPrefix) {
    scanParams.FilterExpression = 'begins_with(id, :prefix)';
    scanParams.ExpressionAttributeValues = { ':prefix': filterPrefix };
  }

  do {
    const response = await docClient.send(
      new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    scanCount++;

    if (response.Items) {
      items.push(...response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;

    // 進捗をログ出力
    if (scanCount % 10 === 0) {
      logger.debug(`スキャン中... ${items.length} 件のアイテムを取得`);
    }
  } while (lastEvaluatedKey);

  // 出力ディレクトリを作成
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // JSONファイルに書き込み
  const exportData = {
    tableName,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    filterPrefix: filterPrefix || null,
    items,
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');

  logger.success(`${items.length} 件のアイテムを ${outputPath} にエクスポートしました`);

  return {
    itemCount: items.length,
    filePath: outputPath,
  };
}

/**
 * SystemContext バックアップをJSONファイルに保存する
 */
export function saveSystemContextBackup(
  backup: SystemContextBackup,
  outputPath: string
): string {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2), 'utf-8');

  logger.info(`SystemContext バックアップを ${outputPath} に保存しました`);

  return outputPath;
}

/**
 * バックアップマニフェストを作成する
 */
export function createBackupManifest(
  environment: string,
  tenantId: string,
  dynamodbBackups: DynamoDBBackupResult[],
  exports: {
    systemContexts?: string;
    chatHistory?: string;
    tokenUsageStats?: string;
    useCaseBuilder?: string;
    bots?: string;
  }
): BackupManifest {
  return {
    environment,
    tenantId,
    createdAt: new Date().toISOString(),
    backups: {
      dynamodb: dynamodbBackups,
      exports,
    },
  };
}

/**
 * バックアップマニフェストを保存する
 */
export function saveBackupManifest(
  manifest: BackupManifest,
  outputDir: string
): string {
  const filePath = path.join(outputDir, 'backup-manifest.json');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');

  logger.info(`バックアップマニフェストを ${filePath} に保存しました`);

  return filePath;
}

/**
 * デフォルトテナントのデータをエクスポートする
 */
export async function exportDefaultTenantData(
  tableNames: {
    chatHistory?: string;
    tokenUsageStats?: string;
    useCaseBuilder?: string;
    bots?: string;
  },
  config: AWSClientConfig,
  outputDir: string,
  includeData: {
    chatHistory: boolean;
    tokenUsageStats: boolean;
    useCaseBuilder: boolean;
    bots: boolean;
  }
): Promise<{ exports: Record<string, string>; itemCounts: Record<string, number> }> {
  logger.startProcess('デフォルトテナントエクスポート');

  const docClient = createDynamoDBDocClient(config);
  const exports: Record<string, string> = {};
  const itemCounts: Record<string, number> = {};

  const tenantDir = path.join(outputDir, 'default');
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  // ChatHistory エクスポート
  if (includeData.chatHistory && tableNames.chatHistory) {
    try {
      const result = await exportTableToJson(
        tableNames.chatHistory,
        docClient,
        path.join(tenantDir, 'ChatHistory-export.json')
      );
      exports.chatHistory = result.filePath;
      itemCounts.chatHistory = result.itemCount;
    } catch (error) {
      logger.warn(`ChatHistory のエクスポートに失敗しました:`, error);
    }
  }

  // TokenUsageStats エクスポート
  if (includeData.tokenUsageStats && tableNames.tokenUsageStats) {
    try {
      const result = await exportTableToJson(
        tableNames.tokenUsageStats,
        docClient,
        path.join(tenantDir, 'TokenUsageStats-export.json')
      );
      exports.tokenUsageStats = result.filePath;
      itemCounts.tokenUsageStats = result.itemCount;
    } catch (error) {
      logger.warn(`TokenUsageStats のエクスポートに失敗しました:`, error);
    }
  }

  // UseCaseBuilder エクスポート
  if (includeData.useCaseBuilder && tableNames.useCaseBuilder) {
    try {
      const result = await exportTableToJson(
        tableNames.useCaseBuilder,
        docClient,
        path.join(tenantDir, 'UseCaseBuilder-export.json')
      );
      exports.useCaseBuilder = result.filePath;
      itemCounts.useCaseBuilder = result.itemCount;
    } catch (error) {
      logger.warn(`UseCaseBuilder のエクスポートに失敗しました:`, error);
    }
  }

  // Bots エクスポート (v0.5.3 BotTableV3)
  if (includeData.bots && tableNames.bots) {
    try {
      const result = await exportTableToJson(
        tableNames.bots,
        docClient,
        path.join(tenantDir, 'Bots-export.json')
      );
      exports.bots = result.filePath;
      itemCounts.bots = result.itemCount;
    } catch (error) {
      logger.warn(`Bots のエクスポートに失敗しました:`, error);
    }
  }

  logger.endProcess('デフォルトテナントエクスポート');

  return { exports, itemCounts };
}

/**
 * テナントのデータをエクスポートする
 */
export async function exportTenantData(
  tenant: DiscoveredTenant,
  config: AWSClientConfig,
  outputDir: string,
  includeData: {
    chatHistory: boolean;
    tokenUsageStats: boolean;
    useCaseBuilder: boolean;
    bots: boolean;
  }
): Promise<{ exports: Record<string, string>; itemCounts: Record<string, number> }> {
  logger.startProcess(`テナント "${tenant.tenantId}" エクスポート`);

  // 現在のアカウントIDを取得
  const { accountId: currentAccountId } = await getCallerIdentity(config);

  let docClient: DynamoDBDocumentClient;

  if (isCrossAccountTenant(tenant, currentAccountId)) {
    // クロスアカウントテナントの場合は AssumeRole
    logger.info(`クロスアカウントテナント "${tenant.tenantId}" のロールをAssume中...`);
    const credentials = await assumeTenantRole(
      tenant.roleArn,
      `migration-export-${tenant.tenantId}`,
      config
    );

    const dynamoClient = new DynamoDBClient({
      region: tenant.region,
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken,
      },
    });

    docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  } else {
    // 同一アカウントの場合
    docClient = createDynamoDBDocClient({
      ...config,
      region: tenant.region,
    });
  }

  const exports: Record<string, string> = {};
  const itemCounts: Record<string, number> = {};

  const tenantDir = path.join(outputDir, `tenant-${tenant.tenantId}`);
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  // ChatHistory エクスポート
  if (includeData.chatHistory && tenant.chatHistoryTableName) {
    try {
      const result = await exportTableToJson(
        tenant.chatHistoryTableName,
        docClient,
        path.join(tenantDir, 'ChatHistory-export.json')
      );
      exports.chatHistory = result.filePath;
      itemCounts.chatHistory = result.itemCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tenant.chatHistoryTableName}" が存在しないためスキップします`);
      } else {
        logger.warn(`ChatHistory のエクスポートに失敗しました:`, error);
      }
    }
  }

  // TokenUsageStats エクスポート
  if (includeData.tokenUsageStats && tenant.tokenUsageStatsTableName) {
    try {
      const result = await exportTableToJson(
        tenant.tokenUsageStatsTableName,
        docClient,
        path.join(tenantDir, 'TokenUsageStats-export.json')
      );
      exports.tokenUsageStats = result.filePath;
      itemCounts.tokenUsageStats = result.itemCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tenant.tokenUsageStatsTableName}" が存在しないためスキップします`);
      } else {
        logger.warn(`TokenUsageStats のエクスポートに失敗しました:`, error);
      }
    }
  }

  // UseCaseBuilder エクスポート
  if (includeData.useCaseBuilder && tenant.useCaseBuilderTableName) {
    try {
      const result = await exportTableToJson(
        tenant.useCaseBuilderTableName,
        docClient,
        path.join(tenantDir, 'UseCaseBuilder-export.json')
      );
      exports.useCaseBuilder = result.filePath;
      itemCounts.useCaseBuilder = result.itemCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tenant.useCaseBuilderTableName}" が存在しないためスキップします`);
      } else {
        logger.warn(`UseCaseBuilder のエクスポートに失敗しました:`, error);
      }
    }
  }

  // Bots エクスポート (v0.5.3 BotTableV3)
  if (includeData.bots && tenant.botTableName) {
    try {
      const result = await exportTableToJson(
        tenant.botTableName,
        docClient,
        path.join(tenantDir, 'Bots-export.json')
      );
      exports.bots = result.filePath;
      itemCounts.bots = result.itemCount;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tenant.botTableName}" が存在しないためスキップします`);
      } else {
        logger.warn(`Bots のエクスポートに失敗しました:`, error);
      }
    }
  }

  logger.endProcess(`テナント "${tenant.tenantId}" エクスポート`);

  return { exports, itemCounts };
}

/**
 * DynamoDB バックアップ一覧をJSONファイルに保存する
 */
export function saveDynamoDBBackupsList(
  backups: DynamoDBBackupResult[],
  outputPath: string
): string {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const data = {
    savedAt: new Date().toISOString(),
    backupCount: backups.length,
    backups,
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  logger.info(`DynamoDB バックアップ一覧を ${outputPath} に保存しました`);

  return outputPath;
}
