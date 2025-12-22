/**
 * レコード数検証モジュール
 * テーブルごとのレコード数を集計・検証
 */

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  AWSClientConfig,
  getDynamoDBClient,
  getDynamoDBDocumentClient,
  getTenantDynamoDBClient,
  getTenantDynamoDBDocumentClient,
} from '../utils/aws';
import {
  TableCounts,
  PrefixCounts,
  DiscoveredTenant,
  IntegrityCheckResult,
  IntegrityIssue,
} from '../config/types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

/**
 * テーブルのアイテム数を DescribeTable から取得（概算）
 */
export async function getTableItemCount(
  client: DynamoDBClient,
  tableName: string
): Promise<number> {
  try {
    const response = await withRetry(() =>
      client.send(
        new DescribeTableCommand({
          TableName: tableName,
        })
      )
    );

    return response.Table?.ItemCount ?? 0;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      return 0;
    }
    throw error;
  }
}

/**
 * プレフィックス別にレコード数をカウント（ChatHistory テーブル用）
 */
export async function countByPrefix(
  docClient: DynamoDBDocumentClient,
  tableName: string
): Promise<PrefixCounts> {
  const counts: PrefixCounts = {
    user: 0,
    chat: 0,
    systemContext: 0,
    stats: 0,
    other: 0,
  };

  const prefixes = [
    { key: 'user', prefix: 'user#' },
    { key: 'chat', prefix: 'chat#' },
    { key: 'systemContext', prefix: 'systemContext#' },
    { key: 'stats', prefix: 'stats#' },
  ];

  // 各プレフィックスでフィルタスキャン
  for (const { key, prefix } of prefixes) {
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let count = 0;

    try {
      do {
        const response = await withRetry(() =>
          docClient.send(
            new ScanCommand({
              TableName: tableName,
              FilterExpression: 'begins_with(id, :prefix)',
              ExpressionAttributeValues: {
                ':prefix': prefix,
              },
              Select: 'COUNT',
              ExclusiveStartKey: lastEvaluatedKey,
            })
          )
        );

        count += response.Count ?? 0;
        lastEvaluatedKey = response.LastEvaluatedKey as
          | Record<string, unknown>
          | undefined;
      } while (lastEvaluatedKey);

      counts[key as keyof PrefixCounts] = count;
    } catch (error) {
      logger.warn(
        `プレフィックス ${prefix} のカウント失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 総数から known prefix を引いて other を計算
  const knownTotal = counts.user + counts.chat + counts.systemContext + counts.stats;
  const totalCount = await getApproximateTotalCount(docClient, tableName);
  counts.other = Math.max(0, totalCount - knownTotal);

  return counts;
}

/**
 * テーブルの概算総数を取得
 */
async function getApproximateTotalCount(
  docClient: DynamoDBDocumentClient,
  tableName: string
): Promise<number> {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let count = 0;

  try {
    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tableName,
            Select: 'COUNT',
            ExclusiveStartKey: lastEvaluatedKey,
          })
        )
      );

      count += response.Count ?? 0;
      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);
  } catch (error) {
    logger.warn(
      `総数カウント失敗: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return count;
}

/**
 * テーブルのレコード数を取得
 */
export async function getTableCounts(
  docClient: DynamoDBDocumentClient,
  client: DynamoDBClient,
  tableName: string,
  includePrefixCounts: boolean = false
): Promise<TableCounts> {
  logger.processing(`レコード数集計: ${tableName}`);

  try {
    // DescribeTable から概算値を取得
    const approximateCount = await getTableItemCount(client, tableName);

    let prefixCounts: PrefixCounts | undefined;

    if (includePrefixCounts) {
      // ChatHistory テーブルの場合はプレフィックス別カウントも取得
      prefixCounts = await countByPrefix(docClient, tableName);
    }

    const result: TableCounts = {
      tableName,
      totalCount: approximateCount,
      prefixCounts,
      countedAt: new Date().toISOString(),
    };

    logger.success(`レコード数: ${tableName} = ${approximateCount} 件`);

    if (prefixCounts) {
      logger.debug(`  user#: ${prefixCounts.user}`);
      logger.debug(`  chat#: ${prefixCounts.chat}`);
      logger.debug(`  systemContext#: ${prefixCounts.systemContext}`);
      logger.debug(`  stats#: ${prefixCounts.stats}`);
      logger.debug(`  other: ${prefixCounts.other}`);
    }

    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return {
        tableName,
        totalCount: 0,
        countedAt: new Date().toISOString(),
      };
    }

    logger.error(
      `レコード数集計失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * デフォルトテナントのテーブルカウントを取得
 */
export async function countDefaultTenantTables(
  config: AWSClientConfig,
  tableNames: string[],
  chatHistoryTableName?: string
): Promise<TableCounts[]> {
  const client = getDynamoDBClient(config);
  const docClient = getDynamoDBDocumentClient(config);
  const results: TableCounts[] = [];

  for (const tableName of tableNames) {
    const includePrefixCounts = tableName === chatHistoryTableName;
    const counts = await getTableCounts(
      docClient,
      client,
      tableName,
      includePrefixCounts
    );
    results.push(counts);
  }

  return results;
}

/**
 * テナント固有のテーブルカウントを取得（クロスアカウント対応）
 */
export async function countTenantTables(
  baseConfig: AWSClientConfig,
  tenant: DiscoveredTenant
): Promise<TableCounts[]> {
  const results: TableCounts[] = [];

  let client: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;

  if (tenant.roleArn) {
    client = await getTenantDynamoDBClient(
      baseConfig,
      tenant.roleArn,
      tenant.tenantId,
      tenant.region
    );
    docClient = await getTenantDynamoDBDocumentClient(
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
    docClient = getDynamoDBDocumentClient({
      ...baseConfig,
      region: tenant.region,
    });
  }

  const tables = [
    { name: tenant.chatHistoryTableName, includePrefixCounts: true },
    { name: tenant.tokenUsageStatsTableName, includePrefixCounts: false },
    { name: tenant.useCaseBuilderTableName, includePrefixCounts: false },
  ];

  for (const table of tables) {
    try {
      const counts = await getTableCounts(
        docClient,
        client,
        table.name,
        table.includePrefixCounts
      );
      results.push(counts);
    } catch (error) {
      logger.error(
        `テナント ${tenant.tenantId} のテーブル ${table.name} カウント失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return results;
}

/**
 * データ整合性チェック
 */
export async function checkDataIntegrity(
  docClient: DynamoDBDocumentClient,
  tableName: string
): Promise<IntegrityCheckResult> {
  logger.processing(`整合性チェック: ${tableName}`);

  const issues: IntegrityIssue[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  const missingIdRecords: string[] = [];
  const missingCreatedDateRecords: string[] = [];

  try {
    do {
      const response = await withRetry(() =>
        docClient.send(
          new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey,
            Limit: 1000,
          })
        )
      );

      for (const item of response.Items ?? []) {
        // id フィールドのチェック
        if (!item.id) {
          missingIdRecords.push(JSON.stringify(item).slice(0, 100));
        }

        // createdDate フィールドのチェック
        if (!item.createdDate) {
          missingCreatedDateRecords.push(String(item.id ?? 'unknown'));
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    // 問題をまとめる
    if (missingIdRecords.length > 0) {
      issues.push({
        type: 'missing_field',
        description: 'id フィールドが存在しないレコードがあります',
        affectedCount: missingIdRecords.length,
        sampleRecordIds: missingIdRecords.slice(0, 5),
      });
    }

    if (missingCreatedDateRecords.length > 0) {
      issues.push({
        type: 'missing_field',
        description: 'createdDate フィールドが存在しないレコードがあります',
        affectedCount: missingCreatedDateRecords.length,
        sampleRecordIds: missingCreatedDateRecords.slice(0, 5),
      });
    }

    const hasIssues = issues.length > 0;

    if (hasIssues) {
      logger.warn(`整合性問題検出: ${tableName} (${issues.length} 件)`);
    } else {
      logger.success(`整合性チェック完了: ${tableName} (問題なし)`);
    }

    return {
      tableName,
      checkedAt: new Date().toISOString(),
      hasIssues,
      issues,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ResourceNotFoundException'
    ) {
      logger.warn(`テーブルが見つかりません: ${tableName}`);
      return {
        tableName,
        checkedAt: new Date().toISOString(),
        hasIssues: false,
        issues: [],
      };
    }

    logger.error(
      `整合性チェック失敗: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

/**
 * カウント結果をファイルに保存
 */
export async function saveCountResults(
  results: TableCounts[],
  outputPath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const data = {
    countedAt: new Date().toISOString(),
    tables: results,
    summary: {
      totalTables: results.length,
      totalRecords: results.reduce((sum, r) => sum + r.totalCount, 0),
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  logger.success(`カウント結果を保存: ${outputPath}`);
}

/**
 * カウントサマリーを表示
 */
export function printCountSummary(results: TableCounts[]): void {
  const totalRecords = results.reduce((sum, r) => sum + r.totalCount, 0);

  logger.summary('レコード数サマリー', {
    'テーブル数': results.length,
    '総レコード数': totalRecords,
  });

  // テーブル別
  const rows = results.map((r) => [r.tableName, r.totalCount]);
  logger.table(['テーブル名', 'レコード数'], rows);
}
