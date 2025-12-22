/**
 * Report Generator
 * Markdown形式のレポートを生成
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  MigrationResults,
  MigrationReport,
  MigrationSummary,
  DiscoveredEnvironment,
  DiscoveredTenant,
  BackupManifest,
  VerificationResult,
  MigrationError,
} from '../config/types';
import * as logger from '../utils/logger';

/**
 * 移行レポートを生成する
 */
export async function generateReport(
  results: MigrationResults
): Promise<MigrationReport> {
  logger.startProcess('レポート生成');

  const markdown = generateMarkdownReport(results);

  const report: MigrationReport = {
    title: `GenU 移行準備レポート (${results.config.sourceVersion} → ${results.config.targetVersion})`,
    generatedAt: new Date().toISOString(),
    results,
    markdown,
  };

  logger.success('レポートを生成しました');
  logger.endProcess('レポート生成');

  return report;
}

/**
 * Markdown形式のレポートを生成する
 */
function generateMarkdownReport(results: MigrationResults): string {
  const lines: string[] = [];

  // ヘッダー
  lines.push('# GenU 移行準備レポート');
  lines.push('');
  lines.push(`**ソースバージョン**: ${results.config.sourceVersion}`);
  lines.push(`**ターゲットバージョン**: ${results.config.targetVersion}`);
  lines.push(`**実行日時**: ${results.executedAt}`);
  lines.push(`**完了日時**: ${results.completedAt || '(未完了)'}`);
  lines.push('');

  // サマリー
  lines.push('## サマリー');
  lines.push('');
  lines.push(formatSummary(results.summary));
  lines.push('');

  // 環境情報
  lines.push('## 検出された環境');
  lines.push('');
  lines.push(formatEnvironments(results.environments));
  lines.push('');

  // テナント情報
  lines.push('## 検出されたテナント');
  lines.push('');
  lines.push(formatTenants(results.tenants));
  lines.push('');

  // バックアップ情報
  lines.push('## バックアップ');
  lines.push('');
  lines.push(formatBackups(results.backupManifests));
  lines.push('');

  // 検証結果
  lines.push('## 検証結果');
  lines.push('');
  lines.push(formatVerifications(results.verificationResults));
  lines.push('');

  // エラー情報
  if (results.errors.length > 0) {
    lines.push('## エラー');
    lines.push('');
    lines.push(formatErrors(results.errors));
    lines.push('');
  }

  // 推奨事項
  lines.push('## 推奨事項');
  lines.push('');
  lines.push(generateRecommendations(results));
  lines.push('');

  // フッター
  lines.push('---');
  lines.push('');
  lines.push('*このレポートは GenU 移行スクリプトによって自動生成されました。*');

  return lines.join('\n');
}

/**
 * サマリーをフォーマットする
 */
function formatSummary(summary: MigrationSummary): string {
  const lines: string[] = [];

  lines.push('| 項目 | 値 |');
  lines.push('|------|-----|');
  lines.push(`| 環境数 | ${summary.environmentCount} |`);
  lines.push(`| テナント数 | ${summary.tenantCount} |`);
  lines.push(`| バックアップ数 | ${summary.backupCount} |`);
  lines.push(`| 成功 | ${summary.successCount} |`);
  lines.push(`| 失敗 | ${summary.failureCount} |`);
  lines.push(`| 警告 | ${summary.warningCount} |`);

  return lines.join('\n');
}

/**
 * 環境情報をフォーマットする
 */
function formatEnvironments(environments: DiscoveredEnvironment[]): string {
  if (environments.length === 0) {
    return '検出された環境はありません。';
  }

  const lines: string[] = [];

  lines.push('| 環境名 | リージョン | スタック名 | ステータス | 更新日時 |');
  lines.push('|--------|------------|------------|-----------|----------|');

  for (const env of environments) {
    lines.push(
      `| ${env.name} | ${env.region} | ${env.stackName} | ${env.stackStatus} | ${env.updatedAt} |`
    );
  }

  return lines.join('\n');
}

/**
 * テナント情報をフォーマットする
 */
function formatTenants(tenants: DiscoveredTenant[]): string {
  if (tenants.length === 0) {
    return '検出されたテナントはありません。';
  }

  const lines: string[] = [];

  lines.push('| テナントID | 環境 | リージョン | ステータス | アカウントID |');
  lines.push('|------------|------|------------|-----------|--------------|');

  for (const tenant of tenants) {
    const accountId = tenant.accountId || '(同一アカウント)';
    lines.push(
      `| ${tenant.tenantId} | ${tenant.environment} | ${tenant.region} | ${tenant.status} | ${accountId} |`
    );
  }

  return lines.join('\n');
}

/**
 * バックアップ情報をフォーマットする
 */
function formatBackups(manifests: BackupManifest[]): string {
  if (manifests.length === 0) {
    return 'バックアップは作成されていません。';
  }

  const lines: string[] = [];

  for (const manifest of manifests) {
    lines.push(`### ${manifest.tenantId} (${manifest.environment})`);
    lines.push('');
    lines.push(`**作成日時**: ${manifest.createdAt}`);
    lines.push('');

    // DynamoDB バックアップ
    if (manifest.backups.dynamodb.length > 0) {
      lines.push('#### DynamoDB バックアップ');
      lines.push('');
      lines.push('| テーブル名 | バックアップ名 | ステータス |');
      lines.push('|------------|----------------|-----------|');

      for (const backup of manifest.backups.dynamodb) {
        lines.push(`| ${backup.tableName} | ${backup.backupName} | ${backup.backupStatus} |`);
      }

      lines.push('');
    }

    // エクスポートファイル
    const exports = manifest.backups.exports;
    const exportEntries = Object.entries(exports).filter(([, value]) => value);

    if (exportEntries.length > 0) {
      lines.push('#### エクスポートファイル');
      lines.push('');

      for (const [key, value] of exportEntries) {
        lines.push(`- **${key}**: ${value}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 検証結果をフォーマットする
 */
function formatVerifications(verifications: VerificationResult[]): string {
  if (verifications.length === 0) {
    return '検証は実行されていません。';
  }

  const lines: string[] = [];

  for (const verification of verifications) {
    const status = verification.overallPassed ? '✓ 成功' : '✗ 失敗';
    lines.push(`### ${verification.tenantId} (${verification.environment}) - ${status}`);
    lines.push('');
    lines.push(`**検証日時**: ${verification.verifiedAt}`);
    lines.push('');

    // テーブルカウント
    if (verification.tableCounts.length > 0) {
      lines.push('#### レコード数');
      lines.push('');
      lines.push('| テーブル | 合計 | user# | chat# | systemContext# |');
      lines.push('|----------|------|-------|-------|----------------|');

      for (const tc of verification.tableCounts) {
        const user = tc.prefixCounts['user#'] || 0;
        const chat = tc.prefixCounts['chat#'] || 0;
        const systemContext = tc.prefixCounts['systemContext#'] || 0;

        lines.push(`| ${tc.tableName} | ${tc.totalItems} | ${user} | ${chat} | ${systemContext} |`);
      }

      lines.push('');
    }

    // 整合性チェック
    if (verification.integrityChecks.length > 0) {
      lines.push('#### 整合性チェック');
      lines.push('');

      for (const check of verification.integrityChecks) {
        const icon = check.passed ? '✓' : '✗';
        lines.push(`- ${icon} **${check.checkName}**: ${check.message}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * エラー情報をフォーマットする
 */
function formatErrors(errors: MigrationError[]): string {
  const lines: string[] = [];

  lines.push('| フェーズ | 環境 | テナント | エラーメッセージ | 発生日時 |');
  lines.push('|----------|------|----------|------------------|----------|');

  for (const error of errors) {
    const env = error.environment || '-';
    const tenant = error.tenantId || '-';
    lines.push(
      `| ${error.phase} | ${env} | ${tenant} | ${error.message} | ${error.occurredAt} |`
    );
  }

  return lines.join('\n');
}

/**
 * 推奨事項を生成する
 */
function generateRecommendations(results: MigrationResults): string {
  const lines: string[] = [];

  // 基本的な推奨事項
  lines.push('### 移行前の確認事項');
  lines.push('');
  lines.push('1. **バックアップの確認**: 上記のDynamoDBバックアップが正常に作成されていることを確認してください。');
  lines.push('2. **SystemContext の確認**: 移行対象の SystemContext データが正しくエクスポートされていることを確認してください。');
  lines.push('3. **テナント設定の確認**: クロスアカウントテナントの IAM ロールが正しく設定されていることを確認してください。');
  lines.push('');

  // 条件付き推奨事項
  if (results.errors.length > 0) {
    lines.push('### 注意事項');
    lines.push('');
    lines.push(`⚠️ ${results.errors.length} 件のエラーが発生しました。移行前に問題を解決してください。`);
    lines.push('');
  }

  // テナント数に応じた推奨事項
  if (results.tenants.length > 10) {
    lines.push('### パフォーマンスに関する推奨事項');
    lines.push('');
    lines.push('- テナント数が多いため、移行は段階的に実施することを推奨します。');
    lines.push('- 各テナントの移行間に適切な間隔を設けてください。');
    lines.push('');
  }

  // 検証結果に応じた推奨事項
  const failedVerifications = results.verificationResults.filter((v) => !v.overallPassed);
  if (failedVerifications.length > 0) {
    lines.push('### 検証失敗に関する推奨事項');
    lines.push('');
    lines.push(`⚠️ ${failedVerifications.length} 件のテナントで検証が失敗しました。`);
    lines.push('');
    for (const v of failedVerifications) {
      lines.push(`- **${v.tenantId}**: 整合性チェックを確認してください。`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * レポートをファイルに保存する
 */
export function saveReport(
  report: MigrationReport,
  outputDir: string
): { markdownPath: string; jsonPath: string } {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const markdownPath = path.join(outputDir, `migration-report-${timestamp}.md`);
  const jsonPath = path.join(outputDir, `migration-report-${timestamp}.json`);

  // Markdown ファイルを保存
  fs.writeFileSync(markdownPath, report.markdown, 'utf-8');
  logger.info(`Markdown レポートを ${markdownPath} に保存しました`);

  // JSON ファイルを保存
  fs.writeFileSync(jsonPath, JSON.stringify(report.results, null, 2), 'utf-8');
  logger.info(`JSON レポートを ${jsonPath} に保存しました`);

  return { markdownPath, jsonPath };
}

/**
 * サマリーを計算する
 */
export function calculateSummary(results: MigrationResults): MigrationSummary {
  const successBackups = results.backupManifests.filter((m) =>
    m.backups.dynamodb.every((b) => b.backupStatus !== 'FAILED')
  ).length;

  const failedBackups = results.backupManifests.length - successBackups;

  const passedVerifications = results.verificationResults.filter((v) => v.overallPassed).length;
  const failedVerifications = results.verificationResults.length - passedVerifications;

  return {
    environmentCount: results.environments.length,
    tenantCount: results.tenants.length,
    backupCount: results.backupManifests.reduce(
      (sum, m) => sum + m.backups.dynamodb.length,
      0
    ),
    successCount: successBackups + passedVerifications,
    failureCount: failedBackups + failedVerifications + results.errors.length,
    warningCount: 0, // 将来的に警告をカウント
  };
}
