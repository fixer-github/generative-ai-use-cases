/**
 * レポートテンプレート
 * Markdown 形式のレポートテンプレートを定義
 */

import {
  MigrationResults,
  EnvironmentSummary,
  DiscoveredEnvironment,
  DiscoveredTenant,
  TableCounts,
  BackupManifest,
  IntegrityCheckResult,
  MigrationError,
} from '../config/types';

/**
 * 日時をフォーマット
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 数値をカンマ区切りでフォーマット
 */
function formatNumber(num: number): string {
  return num.toLocaleString('ja-JP');
}

/**
 * レポートヘッダーを生成
 */
export function generateHeader(results: MigrationResults): string {
  const duration = results.completedAt
    ? Math.round(
        (new Date(results.completedAt).getTime() -
          new Date(results.startedAt).getTime()) /
          1000
      )
    : '-';

  return `# GenU 移行準備レポート

## 概要

| 項目 | 値 |
|------|-----|
| 実行ID | ${results.executionId} |
| 開始日時 | ${formatDateTime(results.startedAt)} |
| 完了日時 | ${results.completedAt ? formatDateTime(results.completedAt) : '未完了'} |
| 実行時間 | ${duration} 秒 |
| 移行元バージョン | ${results.config.sourceVersion} |
| 移行先バージョン | ${results.config.targetVersion} |
| 環境数 | ${results.environments.length} |
| テナント数 | ${results.tenants.length} |
| エラー数 | ${results.errors.length} |

---
`;
}

/**
 * 環境セクションを生成
 */
export function generateEnvironmentSection(
  environments: DiscoveredEnvironment[]
): string {
  if (environments.length === 0) {
    return `## 検出された環境

環境は検出されませんでした。

---
`;
  }

  let content = `## 検出された環境

| 環境名 | リージョン | スタック名 | ステータス | デプロイ日時 |
|--------|-----------|-----------|----------|-------------|
`;

  for (const env of environments) {
    content += `| ${env.name} | ${env.region} | ${env.stackName} | ${env.status} | ${env.deployedAt ? formatDateTime(env.deployedAt) : '-'} |\n`;
  }

  content += `
### テーブル情報

`;

  for (const env of environments) {
    content += `#### ${env.name} 環境

| テーブル種別 | テーブル名 |
|-------------|-----------|
| Tenants | ${env.tenantsTableName ?? '未設定'} |
| ChatHistory | ${env.chatHistoryTableName ?? '未設定'} |
| TokenUsageStats | ${env.tokenUsageStatsTableName ?? '未設定'} |
| UseCaseBuilder | ${env.useCaseBuilderTableName ?? '未設定'} |

`;
  }

  content += '---\n';
  return content;
}

/**
 * テナントセクションを生成
 */
export function generateTenantSection(tenants: DiscoveredTenant[]): string {
  if (tenants.length === 0) {
    return `## テナント情報

テナントは検出されませんでした。

---
`;
  }

  let content = `## テナント情報

### テナント一覧 (${tenants.length} 件)

| テナントID | ステータス | リージョン | アカウントID | 環境 |
|-----------|----------|-----------|-------------|------|
`;

  for (const tenant of tenants) {
    content += `| ${tenant.tenantId} | ${tenant.status} | ${tenant.region} | ${tenant.accountId || '-'} | ${tenant.environment} |\n`;
  }

  content += `
### ステータス別集計

| ステータス | 件数 |
|----------|------|
`;

  const statusCounts = new Map<string, number>();
  for (const tenant of tenants) {
    statusCounts.set(
      tenant.status,
      (statusCounts.get(tenant.status) ?? 0) + 1
    );
  }

  Array.from(statusCounts.entries()).forEach(([status, count]) => {
    content += `| ${status} | ${count} |\n`;
  });

  content += '\n---\n';
  return content;
}

/**
 * バックアップセクションを生成
 */
export function generateBackupSection(backups: BackupManifest[]): string {
  if (backups.length === 0) {
    return `## バックアップ情報

バックアップは作成されませんでした。

---
`;
  }

  let content = `## バックアップ情報

### バックアップサマリー

| テナントID | 環境 | DynamoDB バックアップ | JSON エクスポート | 作成日時 |
|-----------|------|---------------------|------------------|---------|
`;

  for (const backup of backups) {
    content += `| ${backup.tenantId} | ${backup.environment} | ${backup.dynamoDbBackups.length} 件 | ${backup.jsonExports.length} 件 | ${formatDateTime(backup.createdAt)} |\n`;
  }

  content += `
### DynamoDB オンデマンドバックアップ詳細

`;

  for (const backup of backups) {
    if (backup.dynamoDbBackups.length > 0) {
      content += `#### ${backup.tenantId}

| テーブル名 | バックアップ名 | ステータス |
|-----------|--------------|----------|
`;

      for (const db of backup.dynamoDbBackups) {
        content += `| ${db.tableName} | ${db.backupName} | ${db.backupStatus} |\n`;
      }

      content += '\n';
    }
  }

  content += '---\n';
  return content;
}

/**
 * レコード数セクションを生成
 */
export function generateCountsSection(tableCounts: TableCounts[]): string {
  if (tableCounts.length === 0) {
    return `## レコード数

レコード数は集計されませんでした。

---
`;
  }

  const totalRecords = tableCounts.reduce((sum, tc) => sum + tc.totalCount, 0);

  let content = `## レコード数

### サマリー

- テーブル数: ${tableCounts.length}
- 総レコード数: ${formatNumber(totalRecords)}

### テーブル別レコード数

| テーブル名 | レコード数 | 集計日時 |
|-----------|-----------|---------|
`;

  for (const tc of tableCounts) {
    content += `| ${tc.tableName} | ${formatNumber(tc.totalCount)} | ${formatDateTime(tc.countedAt)} |\n`;
  }

  // プレフィックス別の詳細があれば表示
  const tablesWithPrefix = tableCounts.filter((tc) => tc.prefixCounts);

  if (tablesWithPrefix.length > 0) {
    content += `
### プレフィックス別レコード数 (ChatHistory テーブル)

| テーブル名 | user# | chat# | systemContext# | stats# | other |
|-----------|-------|-------|----------------|--------|-------|
`;

    for (const tc of tablesWithPrefix) {
      const pc = tc.prefixCounts!;
      content += `| ${tc.tableName} | ${formatNumber(pc.user)} | ${formatNumber(pc.chat)} | ${formatNumber(pc.systemContext)} | ${formatNumber(pc.stats)} | ${formatNumber(pc.other)} |\n`;
    }
  }

  content += '\n---\n';
  return content;
}

/**
 * 整合性チェックセクションを生成
 */
export function generateIntegritySection(
  results: IntegrityCheckResult[]
): string {
  if (results.length === 0) {
    return `## データ整合性チェック

整合性チェックは実行されませんでした。

---
`;
  }

  const hasAnyIssues = results.some((r) => r.hasIssues);

  let content = `## データ整合性チェック

### チェック結果サマリー

- チェック対象テーブル数: ${results.length}
- 問題のあるテーブル数: ${results.filter((r) => r.hasIssues).length}
- ステータス: ${hasAnyIssues ? '⚠️ 問題あり' : '✅ 問題なし'}

### テーブル別結果

| テーブル名 | ステータス | 問題数 | チェック日時 |
|-----------|----------|-------|-------------|
`;

  for (const r of results) {
    const status = r.hasIssues ? '⚠️ 問題あり' : '✅ OK';
    content += `| ${r.tableName} | ${status} | ${r.issues.length} | ${formatDateTime(r.checkedAt)} |\n`;
  }

  // 問題の詳細
  const resultsWithIssues = results.filter((r) => r.hasIssues);

  if (resultsWithIssues.length > 0) {
    content += `
### 検出された問題

`;

    for (const r of resultsWithIssues) {
      content += `#### ${r.tableName}

`;

      for (const issue of r.issues) {
        content += `- **${issue.type}**: ${issue.description}
  - 影響レコード数: ${formatNumber(issue.affectedCount)}
`;

        if (issue.sampleRecordIds && issue.sampleRecordIds.length > 0) {
          content += `  - サンプル: ${issue.sampleRecordIds.slice(0, 3).join(', ')}...\n`;
        }
      }

      content += '\n';
    }
  }

  content += '---\n';
  return content;
}

/**
 * エラーセクションを生成
 */
export function generateErrorSection(errors: MigrationError[]): string {
  if (errors.length === 0) {
    return `## エラー情報

エラーは発生しませんでした。

---
`;
  }

  let content = `## エラー情報

### エラーサマリー

- 総エラー数: ${errors.length}

### エラー詳細

| # | フェーズ | 環境 | テナント | メッセージ | 発生日時 |
|---|---------|------|---------|----------|---------|
`;

  errors.forEach((error, index) => {
    const message = error.message.length > 50
      ? error.message.slice(0, 47) + '...'
      : error.message;
    content += `| ${index + 1} | ${error.phase} | ${error.environment ?? '-'} | ${error.tenantId ?? '-'} | ${message} | ${formatDateTime(error.occurredAt)} |\n`;
  });

  content += '\n---\n';
  return content;
}

/**
 * フッターを生成
 */
export function generateFooter(): string {
  return `
## 次のステップ

1. バックアップの確認
   - DynamoDB オンデマンドバックアップが正常に作成されていることを確認
   - JSON エクスポートファイルの内容を確認

2. データ整合性の確認
   - 問題が検出された場合は、移行前に修正を検討

3. 移行実行
   - 移行スクリプトを実行して develop ブランチにアップグレード

---

*このレポートは GenU 移行自動化スクリプトによって生成されました*
`;
}
