/**
 * Environment Discovery
 * CloudFormation スタックから GenU 環境を検出
 */

import { DiscoveredEnvironment } from '../config/types';
import {
  AWSClientConfig,
  findGenUStacks,
  getStackDetails,
} from '../utils/aws';
import * as logger from '../utils/logger';

/**
 * スタック名から環境名を抽出する
 * スタック名パターン: GenerativeAiUseCasesStack{env}
 */
function extractEnvironmentName(stackName: string): string {
  const prefix = 'GenerativeAiUseCasesStack';
  if (stackName.startsWith(prefix)) {
    return stackName.slice(prefix.length) || 'default';
  }
  return stackName;
}

/**
 * スタック出力から Tenants テーブル名を取得する
 */
function getTenantsTableName(outputs: Record<string, string>): string | undefined {
  // 一般的な出力キー名をチェック
  const possibleKeys = ['TenantsTableName', 'TenantsTable', 'TenantTableName'];
  for (const key of possibleKeys) {
    if (outputs[key]) {
      return outputs[key];
    }
  }
  return undefined;
}

/**
 * スタック出力から ChatHistory テーブル名を取得する
 */
function getChatHistoryTableName(outputs: Record<string, string>): string | undefined {
  const possibleKeys = ['ChatHistoryTableName', 'ChatHistoryTable', 'ConversationTableName'];
  for (const key of possibleKeys) {
    if (outputs[key]) {
      return outputs[key];
    }
  }
  return undefined;
}

/**
 * スタック出力から TokenUsageStats テーブル名を取得する
 */
function getTokenUsageStatsTableName(outputs: Record<string, string>): string | undefined {
  const possibleKeys = ['TokenUsageStatsTableName', 'TokenUsageStatsTable', 'UsageStatsTableName'];
  for (const key of possibleKeys) {
    if (outputs[key]) {
      return outputs[key];
    }
  }
  return undefined;
}

/**
 * スタック出力から UseCaseBuilder テーブル名を取得する
 */
function getUseCaseBuilderTableName(outputs: Record<string, string>): string | undefined {
  const possibleKeys = ['UseCaseBuilderTableName', 'UseCaseBuilderTable'];
  for (const key of possibleKeys) {
    if (outputs[key]) {
      return outputs[key];
    }
  }
  return undefined;
}

/**
 * 環境を自動検出する
 * CloudFormation スタックから GenU 環境を検出
 */
export async function discoverEnvironments(
  config: AWSClientConfig
): Promise<DiscoveredEnvironment[]> {
  logger.startProcess('環境検出');

  const environments: DiscoveredEnvironment[] = [];

  try {
    // GenU スタックを検索
    logger.info(`リージョン ${config.region} で GenU スタックを検索中...`);
    const stacks = await findGenUStacks(config);

    if (stacks.length === 0) {
      logger.warn(`リージョン ${config.region} に GenU スタックが見つかりませんでした`);
      return environments;
    }

    logger.info(`${stacks.length} 個の GenU スタックが見つかりました`);

    // 各スタックの詳細を取得
    for (const stack of stacks) {
      if (!stack.StackName) continue;

      try {
        logger.debug(`スタック ${stack.StackName} の詳細を取得中...`);
        const details = await getStackDetails(stack.StackName, config);

        const environment: DiscoveredEnvironment = {
          name: extractEnvironmentName(stack.StackName),
          region: config.region,
          stackName: stack.StackName,
          stackStatus: details.status,
          createdAt: details.createdAt,
          updatedAt: details.updatedAt,
          outputs: details.outputs,
          tenantsTableName: getTenantsTableName(details.outputs),
          chatHistoryTableName: getChatHistoryTableName(details.outputs),
          tokenUsageStatsTableName: getTokenUsageStatsTableName(details.outputs),
          useCaseBuilderTableName: getUseCaseBuilderTableName(details.outputs),
        };

        environments.push(environment);

        logger.success(`環境 "${environment.name}" を検出しました (${environment.stackStatus})`);

        // テーブル情報をログ出力
        if (environment.tenantsTableName) {
          logger.debug(`  Tenants テーブル: ${environment.tenantsTableName}`);
        }
        if (environment.chatHistoryTableName) {
          logger.debug(`  ChatHistory テーブル: ${environment.chatHistoryTableName}`);
        }
      } catch (error) {
        logger.error(`スタック ${stack.StackName} の詳細取得に失敗しました:`, error);
      }
    }

    logger.endProcess('環境検出');
    return environments;
  } catch (error) {
    logger.failProcess('環境検出', error);
    throw error;
  }
}

/**
 * 指定された環境名の環境を検出する
 */
export async function discoverEnvironmentByName(
  environmentName: string,
  config: AWSClientConfig
): Promise<DiscoveredEnvironment | null> {
  const stackName = `GenerativeAiUseCasesStack${environmentName}`;

  logger.info(`環境 "${environmentName}" (スタック: ${stackName}) を検索中...`);

  try {
    const details = await getStackDetails(stackName, config);

    const environment: DiscoveredEnvironment = {
      name: environmentName,
      region: config.region,
      stackName,
      stackStatus: details.status,
      createdAt: details.createdAt,
      updatedAt: details.updatedAt,
      outputs: details.outputs,
      tenantsTableName: getTenantsTableName(details.outputs),
      chatHistoryTableName: getChatHistoryTableName(details.outputs),
      tokenUsageStatsTableName: getTokenUsageStatsTableName(details.outputs),
      useCaseBuilderTableName: getUseCaseBuilderTableName(details.outputs),
    };

    logger.success(`環境 "${environmentName}" を検出しました`);
    return environment;
  } catch (error) {
    logger.warn(`環境 "${environmentName}" が見つかりませんでした:`, error);
    return null;
  }
}

/**
 * 検出結果を表示用にフォーマットする
 */
export function formatEnvironmentSummary(
  environments: DiscoveredEnvironment[]
): string {
  if (environments.length === 0) {
    return '検出された環境はありません';
  }

  const lines: string[] = [
    '検出された環境:',
    '',
    '| 環境名 | リージョン | スタック | ステータス | Tenantsテーブル |',
    '|--------|------------|----------|-----------|-----------------|',
  ];

  for (const env of environments) {
    const tenantsTable = env.tenantsTableName || '(なし)';
    lines.push(
      `| ${env.name} | ${env.region} | ${env.stackName} | ${env.stackStatus} | ${tenantsTable} |`
    );
  }

  return lines.join('\n');
}
