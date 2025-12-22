/**
 * レポート生成モジュール
 * Markdown 形式のレポートを生成
 */

import {
  MigrationResults,
  MigrationReport,
  EnvironmentSummary,
  TenantStatus,
} from '../config/types';
import {
  generateHeader,
  generateEnvironmentSection,
  generateTenantSection,
  generateBackupSection,
  generateCountsSection,
  generateIntegritySection,
  generateErrorSection,
  generateFooter,
} from './templates';
import { logger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 環境サマリーを計算
 */
function calculateEnvironmentSummaries(
  results: MigrationResults
): EnvironmentSummary[] {
  const summaries: EnvironmentSummary[] = [];

  // 環境ごとにグループ化
  const envMap = new Map<string, EnvironmentSummary>();

  for (const env of results.environments) {
    if (!envMap.has(env.name)) {
      envMap.set(env.name, {
        environment: env.name,
        region: env.region,
        tenantCount: 0,
        tableCount: 0,
        totalRecords: 0,
        backupsSucceeded: 0,
        backupsFailed: 0,
      });
    }
  }

  // テナント数をカウント
  for (const tenant of results.tenants) {
    const summary = envMap.get(tenant.environment);
    if (summary && tenant.status === TenantStatus.ACTIVE) {
      summary.tenantCount++;
      summary.tableCount += 3; // ChatHistory, TokenUsageStats, UseCaseBuilder
    }
  }

  // レコード数を集計
  for (const tc of results.tableCounts) {
    // テーブル名から環境を推測
    for (const [envName, summary] of Array.from(envMap.entries())) {
      if (tc.tableName.toLowerCase().includes(envName.toLowerCase())) {
        summary.totalRecords += tc.totalCount;
        break;
      }
    }
  }

  // バックアップ結果を集計
  for (const backup of results.backups) {
    const summary = envMap.get(backup.environment);
    if (summary) {
      const succeeded = backup.dynamoDbBackups.filter(
        (b) => b.backupStatus === 'AVAILABLE' || b.backupStatus === 'DRY_RUN'
      ).length;
      summary.backupsSucceeded += succeeded;
      summary.backupsFailed +=
        backup.dynamoDbBackups.length - succeeded;
    }
  }

  return Array.from(envMap.values());
}

/**
 * Markdown レポートを生成
 */
export function generateMarkdownReport(results: MigrationResults): string {
  const sections: string[] = [];

  // ヘッダー
  sections.push(generateHeader(results));

  // 環境セクション
  sections.push(generateEnvironmentSection(results.environments));

  // テナントセクション
  sections.push(generateTenantSection(results.tenants));

  // バックアップセクション
  sections.push(generateBackupSection(results.backups));

  // レコード数セクション
  sections.push(generateCountsSection(results.tableCounts));

  // 整合性チェックセクション
  sections.push(generateIntegritySection(results.integrityChecks));

  // エラーセクション
  sections.push(generateErrorSection(results.errors));

  // フッター
  sections.push(generateFooter());

  return sections.join('\n');
}

/**
 * レポートを生成
 */
export function generateReport(results: MigrationResults): MigrationReport {
  logger.processing('レポート生成中...');

  // サマリーを計算
  results.summaries = calculateEnvironmentSummaries(results);

  // Markdown コンテンツを生成
  const markdownContent = generateMarkdownReport(results);

  const report: MigrationReport = {
    title: `GenU 移行準備レポート - ${new Date().toISOString().split('T')[0]}`,
    generatedAt: new Date().toISOString(),
    markdownContent,
    jsonData: results,
  };

  logger.success('レポート生成完了');

  return report;
}

/**
 * レポートをファイルに保存
 */
export async function saveReport(
  report: MigrationReport,
  outputDir: string
): Promise<{ markdownPath: string; jsonPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

  // Markdown ファイルを保存
  const markdownPath = path.join(outputDir, `migration-report-${timestamp}.md`);
  await fs.writeFile(markdownPath, report.markdownContent, 'utf-8');
  logger.success(`Markdown レポートを保存: ${markdownPath}`);

  // JSON ファイルを保存
  const jsonPath = path.join(outputDir, `migration-report-${timestamp}.json`);
  await fs.writeFile(
    jsonPath,
    JSON.stringify(report.jsonData, null, 2),
    'utf-8'
  );
  logger.success(`JSON レポートを保存: ${jsonPath}`);

  return { markdownPath, jsonPath };
}

/**
 * 結果オブジェクトを初期化
 */
export function initializeResults(
  config: import('../config/types').MigrationConfig
): MigrationResults {
  return {
    executionId: `migration-${Date.now()}`,
    startedAt: new Date().toISOString(),
    config,
    environments: [],
    tenants: [],
    backups: [],
    tableCounts: [],
    integrityChecks: [],
    summaries: [],
    errors: [],
  };
}

/**
 * 結果を完了状態に更新
 */
export function finalizeResults(results: MigrationResults): void {
  results.completedAt = new Date().toISOString();
}

/**
 * エラーを結果に追加
 */
export function addError(
  results: MigrationResults,
  phase: 'discovery' | 'backup' | 'verification' | 'report',
  error: Error,
  environment?: string,
  tenantId?: string
): void {
  results.errors.push({
    phase,
    environment,
    tenantId,
    message: error.message,
    stack: error.stack,
    occurredAt: new Date().toISOString(),
  });
}

/**
 * 簡易サマリーをコンソールに出力
 */
export function printFinalSummary(results: MigrationResults): void {
  const duration = results.completedAt
    ? Math.round(
        (new Date(results.completedAt).getTime() -
          new Date(results.startedAt).getTime()) /
          1000
      )
    : 0;

  logger.summary('移行準備完了', {
    '実行ID': results.executionId,
    '実行時間': `${duration} 秒`,
    '検出環境数': results.environments.length,
    '検出テナント数': results.tenants.length,
    'バックアップ数': results.backups.reduce(
      (sum, b) => sum + b.dynamoDbBackups.length,
      0
    ),
    'エラー数': results.errors.length,
  });
}
