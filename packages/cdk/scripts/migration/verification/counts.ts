/**
 * Record Counts Verification
 * テーブルごとのレコード数を集計・検証
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  TableCounts,
  IntegrityCheckResult,
  VerificationResult,
  DiscoveredTenant,
} from '../config/types';
import {
  AWSClientConfig,
  createDynamoDBDocClient,
  createDynamoDBClient,
  assumeTenantRole,
  getCallerIdentity,
} from '../utils/aws';
import { isCrossAccountTenant } from '../discovery/tenant';
import * as logger from '../utils/logger';

/**
 * 既知のプレフィックス一覧
 */
const KNOWN_PREFIXES = [
  'user#',
  'chat#',
  'systemContext#',
  'stats#',
  'feedback#',
  'session#',
  'assistant#',
];

/**
 * テーブルのレコード数を取得する (概算)
 */
export async function getTableItemCount(
  tableName: string,
  client: DynamoDBClient
): Promise<number> {
  const response = await client.send(
    new DescribeTableCommand({
      TableName: tableName,
    })
  );

  return response.Table?.ItemCount || 0;
}

/**
 * テーブルのプレフィックス別カウントを取得する
 */
export async function getTablePrefixCounts(
  tableName: string,
  docClient: DynamoDBDocumentClient
): Promise<Record<string, number>> {
  logger.info(`テーブル "${tableName}" のプレフィックス別カウントを取得中...`);

  const prefixCounts: Record<string, number> = {};
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let totalScanned = 0;

  // 初期化
  for (const prefix of KNOWN_PREFIXES) {
    prefixCounts[prefix] = 0;
  }
  prefixCounts['other'] = 0;

  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'id',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const id = item.id as string;
        totalScanned++;

        // プレフィックスを特定
        let matched = false;
        for (const prefix of KNOWN_PREFIXES) {
          if (id && id.startsWith(prefix)) {
            prefixCounts[prefix]++;
            matched = true;
            break;
          }
        }

        if (!matched) {
          prefixCounts['other']++;
        }
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;

    // 進捗をログ出力
    if (totalScanned % 10000 === 0) {
      logger.debug(`スキャン中... ${totalScanned} 件処理`);
    }
  } while (lastEvaluatedKey);

  logger.debug(`合計 ${totalScanned} 件のアイテムをスキャンしました`);

  return prefixCounts;
}

/**
 * テーブルカウントを取得する
 */
export async function getTableCounts(
  tableName: string,
  docClient: DynamoDBDocumentClient,
  dynamoClient: DynamoDBClient
): Promise<TableCounts> {
  logger.startProcess(`テーブルカウント取得 (${tableName})`);

  try {
    // 概算アイテム数を取得
    const estimatedCount = await getTableItemCount(tableName, dynamoClient);

    // プレフィックス別カウントを取得
    const prefixCounts = await getTablePrefixCounts(tableName, docClient);

    // 合計を計算
    const totalItems = Object.values(prefixCounts).reduce((sum, count) => sum + count, 0);

    const result: TableCounts = {
      tableName,
      totalItems,
      prefixCounts,
      countedAt: new Date().toISOString(),
    };

    logger.success(`テーブル "${tableName}": ${totalItems} 件 (概算: ${estimatedCount} 件)`);
    logger.endProcess(`テーブルカウント取得 (${tableName})`);

    return result;
  } catch (error) {
    logger.failProcess(`テーブルカウント取得 (${tableName})`, error);
    throw error;
  }
}

/**
 * 整合性チェックを実行する
 */
export function runIntegrityChecks(
  tableCounts: TableCounts[]
): IntegrityCheckResult[] {
  const results: IntegrityCheckResult[] = [];

  // チェック1: テーブルが存在するか
  results.push({
    checkName: 'テーブル存在チェック',
    passed: tableCounts.length > 0,
    message:
      tableCounts.length > 0
        ? `${tableCounts.length} 個のテーブルが見つかりました`
        : 'テーブルが見つかりませんでした',
  });

  // チェック2: レコードが存在するか
  const totalRecords = tableCounts.reduce((sum, tc) => sum + tc.totalItems, 0);
  results.push({
    checkName: 'レコード存在チェック',
    passed: totalRecords > 0,
    message: `合計 ${totalRecords} 件のレコードが見つかりました`,
    details: { totalRecords },
  });

  // チェック3: SystemContext が存在するか
  const systemContextCounts = tableCounts
    .filter((tc) => tc.prefixCounts['systemContext#'] > 0)
    .map((tc) => ({
      tableName: tc.tableName,
      count: tc.prefixCounts['systemContext#'],
    }));

  const totalSystemContexts = systemContextCounts.reduce(
    (sum, sc) => sum + sc.count,
    0
  );

  results.push({
    checkName: 'SystemContext 存在チェック',
    passed: true, // SystemContext がなくてもエラーではない
    message:
      totalSystemContexts > 0
        ? `${totalSystemContexts} 件の SystemContext が見つかりました`
        : 'SystemContext は見つかりませんでした (正常)',
    details: { systemContextCounts },
  });

  // チェック4: 不明なプレフィックスのレコード
  const unknownPrefixCounts = tableCounts
    .filter((tc) => tc.prefixCounts['other'] > 0)
    .map((tc) => ({
      tableName: tc.tableName,
      count: tc.prefixCounts['other'],
    }));

  const totalUnknown = unknownPrefixCounts.reduce((sum, uc) => sum + uc.count, 0);

  results.push({
    checkName: '不明プレフィックスチェック',
    passed: true, // 警告として記録
    message:
      totalUnknown > 0
        ? `${totalUnknown} 件の不明なプレフィックスのレコードがあります`
        : '全てのレコードが既知のプレフィックスを持っています',
    details: { unknownPrefixCounts },
  });

  return results;
}

/**
 * デフォルトテナントの検証を実行する
 */
export async function verifyDefaultTenant(
  tableNames: string[],
  environment: string,
  config: AWSClientConfig
): Promise<VerificationResult> {
  logger.startProcess(`デフォルトテナント検証 (${environment})`);

  const docClient = createDynamoDBDocClient(config);
  const dynamoClient = createDynamoDBClient(config);
  const tableCounts: TableCounts[] = [];

  for (const tableName of tableNames) {
    if (!tableName) continue;

    try {
      const counts = await getTableCounts(tableName, docClient, dynamoClient);
      tableCounts.push(counts);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tableName}" が存在しないためスキップします`);
      } else {
        logger.error(`テーブル "${tableName}" のカウント取得に失敗しました:`, error);
      }
    }
  }

  const integrityChecks = runIntegrityChecks(tableCounts);
  const overallPassed = integrityChecks.every((check) => check.passed);

  const result: VerificationResult = {
    environment,
    tenantId: 'default',
    verifiedAt: new Date().toISOString(),
    tableCounts,
    integrityChecks,
    overallPassed,
  };

  logger.endProcess(`デフォルトテナント検証 (${environment})`);

  return result;
}

/**
 * テナントの検証を実行する
 */
export async function verifyTenant(
  tenant: DiscoveredTenant,
  config: AWSClientConfig
): Promise<VerificationResult> {
  logger.startProcess(`テナント "${tenant.tenantId}" 検証`);

  // 現在のアカウントIDを取得
  const { accountId: currentAccountId } = await getCallerIdentity(config);

  let docClient: DynamoDBDocumentClient;
  let dynamoClient: DynamoDBClient;

  if (isCrossAccountTenant(tenant, currentAccountId)) {
    // クロスアカウントテナントの場合は AssumeRole
    logger.info(`クロスアカウントテナント "${tenant.tenantId}" のロールをAssume中...`);
    const credentials = await assumeTenantRole(
      tenant.roleArn,
      `migration-verify-${tenant.tenantId}`,
      config
    );

    dynamoClient = new DynamoDBClient({
      region: tenant.region,
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken,
      },
    });

    const { DynamoDBDocumentClient: DocClient } = await import('@aws-sdk/lib-dynamodb');
    docClient = DocClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  } else {
    // 同一アカウントの場合
    dynamoClient = createDynamoDBClient({
      ...config,
      region: tenant.region,
    });
    docClient = createDynamoDBDocClient({
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

  const tableCounts: TableCounts[] = [];

  for (const tableName of tableNames) {
    try {
      const counts = await getTableCounts(tableName, docClient, dynamoClient);
      tableCounts.push(counts);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('not found')) {
        logger.warn(`テーブル "${tableName}" が存在しないためスキップします`);
      } else {
        logger.error(`テーブル "${tableName}" のカウント取得に失敗しました:`, error);
      }
    }
  }

  const integrityChecks = runIntegrityChecks(tableCounts);
  const overallPassed = integrityChecks.every((check) => check.passed);

  const result: VerificationResult = {
    environment: tenant.environment,
    tenantId: tenant.tenantId,
    verifiedAt: new Date().toISOString(),
    tableCounts,
    integrityChecks,
    overallPassed,
  };

  logger.endProcess(`テナント "${tenant.tenantId}" 検証`);

  return result;
}

/**
 * 検証結果を表示用にフォーマットする
 */
export function formatVerificationSummary(result: VerificationResult): string {
  const lines: string[] = [
    `検証結果: ${result.tenantId} (${result.environment})`,
    `検証日時: ${result.verifiedAt}`,
    `全体結果: ${result.overallPassed ? '成功' : '失敗'}`,
    '',
    'テーブルカウント:',
    '',
    '| テーブル名 | 合計 | user# | chat# | systemContext# | その他 |',
    '|------------|------|-------|-------|----------------|--------|',
  ];

  for (const tc of result.tableCounts) {
    const user = tc.prefixCounts['user#'] || 0;
    const chat = tc.prefixCounts['chat#'] || 0;
    const systemContext = tc.prefixCounts['systemContext#'] || 0;
    const other = tc.prefixCounts['other'] || 0;

    lines.push(
      `| ${tc.tableName} | ${tc.totalItems} | ${user} | ${chat} | ${systemContext} | ${other} |`
    );
  }

  lines.push('');
  lines.push('整合性チェック:');
  lines.push('');

  for (const check of result.integrityChecks) {
    const status = check.passed ? '✓' : '✗';
    lines.push(`  ${status} ${check.checkName}: ${check.message}`);
  }

  return lines.join('\n');
}
