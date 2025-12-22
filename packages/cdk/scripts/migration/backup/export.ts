/**
 * JSON エクスポートモジュール
 * DynamoDB テーブルデータを JSON ファイルにエクスポート
 */

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  AWSClientConfig,
  getDynamoDBDocumentClient,
  getTenantDynamoDBDocumentClient,
} from '../utils/aws';
import { JsonExportResult, DiscoveredTenant } from '../config/types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * テーブル全体を JSON にエクスポート
 */
export async function exportTableToJson(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  outputPath: string,
  dryRun: boolean = false
): Promise<JsonExportResult> {
  logger.processing(`JSON エクスポート: ${tableName}`);

  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let scannedCount = 0;

  try {
    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey,
          })
        )
      );

      scannedCount += response.Count ?? 0;

      for (const item of response.Items ?? []) {
        items.push(item);
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;

      // 進捗表示（10000件ごと）
      if (items.length % 10000 === 0 && items.length > 0) {
        logger.debug(`  ${items.length} 件取得中...`);
      }
    } while (lastEvaluatedKey);

    // ファイル出力
    if (dryRun) {
      logger.dryRun(`JSON エクスポート: ${tableName} -> ${outputPath}`);
      return {
        tableName,
        filePath: outputPath,
        recordCount: items.length,
        fileSizeBytes: 0,
        exportedAt: new Date().toISOString(),
      };
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const jsonContent = JSON.stringify(
      {
        tableName,
        exportedAt: new Date().toISOString(),
        recordCount: items.length,
        items,
      },
      null,
      2
    );

    await fs.writeFile(outputPath, jsonContent, 'utf-8');

    const stats = await fs.stat(outputPath);

    logger.success(
      `JSON エクスポート完了: ${items.length} 件 (${formatFileSize(stats.size)})`
    );

    return {
      tableName,
      filePath: outputPath,
      recordCount: items.length,
      fileSizeBytes: stats.size,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return {
        tableName,
        filePath: outputPath,
        recordCount: 0,
        fileSizeBytes: 0,
        exportedAt: new Date().toISOString(),
      };
    }

    logger.error(
      `JSON エクスポート失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * プレフィックスでフィルタリングしてエクスポート
 */
export async function exportTableWithPrefixFilter(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  outputPath: string,
  idPrefix: string,
  dryRun: boolean = false
): Promise<JsonExportResult> {
  logger.processing(
    `JSON エクスポート (${idPrefix}*): ${tableName}`
  );

  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  try {
    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'begins_with(id, :prefix)',
            ExpressionAttributeValues: {
              ':prefix': idPrefix,
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        )
      );

      for (const item of response.Items ?? []) {
        items.push(item);
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    if (dryRun) {
      logger.dryRun(`JSON エクスポート: ${tableName} -> ${outputPath}`);
      return {
        tableName,
        filePath: outputPath,
        recordCount: items.length,
        fileSizeBytes: 0,
        exportedAt: new Date().toISOString(),
      };
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const jsonContent = JSON.stringify(
      {
        tableName,
        filterPrefix: idPrefix,
        exportedAt: new Date().toISOString(),
        recordCount: items.length,
        items,
      },
      null,
      2
    );

    await fs.writeFile(outputPath, jsonContent, 'utf-8');

    const stats = await fs.stat(outputPath);

    logger.success(
      `JSON エクスポート完了: ${items.length} 件 (${formatFileSize(stats.size)})`
    );

    return {
      tableName,
      filePath: outputPath,
      recordCount: items.length,
      fileSizeBytes: stats.size,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return {
        tableName,
        filePath: outputPath,
        recordCount: 0,
        fileSizeBytes: 0,
        exportedAt: new Date().toISOString(),
      };
    }

    logger.error(
      `JSON エクスポート失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * デフォルトテナントのテーブルをエクスポート
 */
export async function exportDefaultTenantTables(
  config: AWSClientConfig,
  tableNames: string[],
  outputDir: string,
  dryRun: boolean = false
): Promise<JsonExportResult[]> {
  const docClient = getDynamoDBDocumentClient(config);
  const results: JsonExportResult[] = [];

  for (const tableName of tableNames) {
    const outputPath = path.join(outputDir, `${tableName}-export.json`);
    const result = await exportTableToJson(
      docClient,
      tableName,
      outputPath,
      dryRun
    );
    results.push(result);
  }

  return results;
}

/**
 * テナント固有のテーブルをエクスポート（クロスアカウント対応）
 */
export async function exportTenantTables(
  baseConfig: AWSClientConfig,
  tenant: DiscoveredTenant,
  outputDir: string,
  dryRun: boolean = false
): Promise<JsonExportResult[]> {
  const results: JsonExportResult[] = [];

  let docClient: DynamoDBDocumentClient;

  if (tenant.roleArn) {
    docClient = await getTenantDynamoDBDocumentClient(
      baseConfig,
      tenant.roleArn,
      tenant.tenantId,
      tenant.region
    );
  } else {
    docClient = getDynamoDBDocumentClient({
      ...baseConfig,
      region: tenant.region,
    });
  }

  const tables = [
    { name: tenant.chatHistoryTableName, label: 'ChatHistory' },
    { name: tenant.tokenUsageStatsTableName, label: 'TokenUsageStats' },
    { name: tenant.useCaseBuilderTableName, label: 'UseCaseBuilder' },
  ];

  for (const table of tables) {
    try {
      const outputPath = path.join(outputDir, `${table.label}-export.json`);
      const result = await exportTableToJson(
        docClient,
        table.name,
        outputPath,
        dryRun
      );
      results.push(result);
    } catch (error) {
      logger.error(
        `テナント ${tenant.tenantId} のテーブル ${table.name} エクスポート失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return results;
}

/**
 * ファイルサイズを人間が読みやすい形式にフォーマット
 */
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * エクスポート結果のサマリーを表示
 */
export function printExportSummary(results: JsonExportResult[]): void {
  const totalRecords = results.reduce((sum, r) => sum + r.recordCount, 0);
  const totalSize = results.reduce((sum, r) => sum + r.fileSizeBytes, 0);

  logger.summary('JSON エクスポートサマリー', {
    'ファイル数': results.length,
    '総レコード数': totalRecords,
    '総ファイルサイズ': formatFileSize(totalSize),
  });
}
