/**
 * 環境検出モジュール
 * CloudFormation スタックから GenU 環境を検出
 */

import {
  listGenUStacks,
  describeStack,
  getStackOutputValue,
} from '../utils/aws';
import { DiscoveredEnvironment, AWSClientConfig } from '../config/types';
import { logger } from '../utils/logger';

// Stack 型定義（SDK インポートを避けるため）
interface Stack {
  StackName?: string;
  StackStatus?: string;
  CreationTime?: Date;
  LastUpdatedTime?: Date;
  Outputs?: { OutputKey?: string; OutputValue?: string }[];
}

/**
 * スタック名から環境名を抽出
 * 例: GenerativeAiUseCasesStackDev -> dev
 *     GenerativeAiUseCasesStackProd -> prod
 *     GenerativeAiUseCasesStack -> default
 */
function extractEnvironmentName(stackName: string): string {
  // GenerativeAiUseCasesStack{Env} パターン
  const match = stackName.match(/GenerativeAiUseCasesStack(.*)$/);

  if (match && match[1]) {
    // 最初の大文字区切りを取得 (例: DevApiStack -> Dev)
    const envPart = match[1].split(/(?=[A-Z])/)[0];
    return envPart.toLowerCase() || 'default';
  }

  return 'default';
}

/**
 * スタックが GenU メインスタックかどうかを判定
 */
function isMainGenUStack(stackName: string): boolean {
  // サブスタック（NestedStack）を除外
  if (stackName.includes('NestedStack')) {
    return false;
  }

  // API スタックやその他のサブスタックを除外
  if (
    stackName.includes('ApiStack') ||
    stackName.includes('WebStack') ||
    stackName.includes('AuthStack')
  ) {
    return false;
  }

  // メインスタック: GenerativeAiUseCasesStack または GenerativeAiUseCasesStack{Env}
  return /^GenerativeAiUseCasesStack[A-Z]?[a-z]*$/.test(stackName);
}

/**
 * スタックからテーブル名を抽出
 */
function extractTableNames(stack: Stack): {
  tenantsTableName?: string;
  chatHistoryTableName?: string;
  tokenUsageStatsTableName?: string;
  useCaseBuilderTableName?: string;
} {
  return {
    tenantsTableName: getStackOutputValue(stack, 'TenantsTableName'),
    chatHistoryTableName: getStackOutputValue(stack, 'ChatHistoryTableName'),
    tokenUsageStatsTableName: getStackOutputValue(
      stack,
      'TokenUsageStatsTableName'
    ),
    useCaseBuilderTableName: getStackOutputValue(
      stack,
      'UseCaseBuilderTableName'
    ),
  };
}

/**
 * CloudFormation スタックから GenU 環境を検出
 */
export async function discoverEnvironments(
  config: AWSClientConfig
): Promise<DiscoveredEnvironment[]> {
  logger.info(`リージョン ${config.region} で環境を検出中...`);

  const environments: DiscoveredEnvironment[] = [];

  try {
    // GenU スタック一覧を取得
    const stacks = await listGenUStacks(config);
    logger.debug(`${stacks.length} 件の GenU 関連スタックを発見`);

    // メインスタックをフィルタリング
    const mainStacks = stacks.filter((s) => isMainGenUStack(s.StackName ?? ''));
    logger.info(`${mainStacks.length} 件のメインスタックを検出`);

    for (const stackSummary of mainStacks) {
      const stackName = stackSummary.StackName!;

      try {
        // スタック詳細を取得
        const stack = await describeStack(config, stackName);

        if (!stack) {
          logger.warn(`スタック ${stackName} の詳細を取得できませんでした`);
          continue;
        }

        const environmentName = extractEnvironmentName(stackName);
        const tableNames = extractTableNames(stack);

        const environment: DiscoveredEnvironment = {
          name: environmentName,
          region: config.region,
          stackName: stackName,
          status: stack.StackStatus ?? 'UNKNOWN',
          deployedAt: stack.LastUpdatedTime?.toISOString() ??
            stack.CreationTime?.toISOString(),
          ...tableNames,
        };

        environments.push(environment);

        logger.success(
          `環境検出: ${environmentName} (${stackName})`
        );

        if (tableNames.tenantsTableName) {
          logger.debug(`  テナントテーブル: ${tableNames.tenantsTableName}`);
        }
        if (tableNames.chatHistoryTableName) {
          logger.debug(
            `  ChatHistory テーブル: ${tableNames.chatHistoryTableName}`
          );
        }
      } catch (error) {
        logger.error(
          `スタック ${stackName} の処理中にエラー: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } catch (error) {
    logger.error(
      `環境検出中にエラー: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  return environments;
}

/**
 * 複数リージョンで環境を検出
 */
export async function discoverEnvironmentsMultiRegion(
  configs: AWSClientConfig[]
): Promise<DiscoveredEnvironment[]> {
  const allEnvironments: DiscoveredEnvironment[] = [];

  for (const config of configs) {
    try {
      const environments = await discoverEnvironments(config);
      allEnvironments.push(...environments);
    } catch (error) {
      logger.error(
        `リージョン ${config.region} での検出に失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return allEnvironments;
}

/**
 * 環境情報をファイルに保存
 */
export async function saveEnvironmentsToFile(
  environments: DiscoveredEnvironment[],
  outputPath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const data = {
    discoveredAt: new Date().toISOString(),
    count: environments.length,
    environments,
  };

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  logger.success(`環境情報を保存: ${outputPath}`);
}
