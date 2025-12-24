/**
 * Migration Configuration Types
 * v0.5.3 -> develop 移行スクリプトの設定型定義
 */

// ============================================================================
// 設定ファイル型
// ============================================================================

/**
 * 環境設定
 */
export interface EnvironmentConfig {
  /** 環境名 (dev, staging, prod など) */
  name: string;
  /** AWS リージョン */
  region: string;
  /** AWS プロファイル名 */
  awsProfile?: string;
  /** 除外するテナントID一覧 */
  excludeTenants?: string[];
}

/**
 * テーブル設定
 */
export interface TableSettings {
  /** オンデマンドバックアップを作成するか */
  createOnDemandBackups: boolean;
  /** JSONエクスポートを行うか */
  exportToJson: boolean;
  /** データを含めるか */
  includeData: {
    systemContexts: boolean;
    chatHistory: boolean;
    tokenUsageStats: boolean;
    useCaseBuilder: boolean;
    /** Bot データ (v0.5.3 の BotTableV3) */
    bots: boolean;
  };
}

/**
 * 移行スクリプト設定
 */
export interface MigrationSettings {
  /** ドライラン実行 */
  dryRun: boolean;
  /** 出力先ディレクトリ */
  outputDir: string;
  /** 並列実行数 */
  parallelism: number;
  /** テーブル設定 */
  tables: TableSettings;
}

/**
 * 移行設定ファイル (migration-config.json)
 */
export interface MigrationConfig {
  /** ソースバージョン */
  sourceVersion: string;
  /** ターゲットバージョン */
  targetVersion: string;
  /** 環境一覧 */
  environments: EnvironmentConfig[];
  /** 設定 */
  settings: MigrationSettings;
}

// ============================================================================
// 検出結果型
// ============================================================================

/**
 * 検出された環境
 */
export interface DiscoveredEnvironment {
  /** 環境名 */
  name: string;
  /** AWS リージョン */
  region: string;
  /** CloudFormation スタック名 */
  stackName: string;
  /** スタックのステータス */
  stackStatus: string;
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** スタック出力 */
  outputs: Record<string, string>;
  /** Tenants テーブル名 */
  tenantsTableName?: string;
  /** ChatHistory テーブル名 (デフォルトテナント用) */
  chatHistoryTableName?: string;
  /** TokenUsageStats テーブル名 (デフォルトテナント用) */
  tokenUsageStatsTableName?: string;
  /** UseCaseBuilder テーブル名 (デフォルトテナント用) */
  useCaseBuilderTableName?: string;
  /** Bot テーブル名 (v0.5.3 BotTableV3) */
  botTableName?: string;
}

/**
 * 検出されたテナント
 */
export interface DiscoveredTenant {
  /** テナントID */
  tenantId: string;
  /** テナントステータス */
  status: string;
  /** AWS リージョン */
  region: string;
  /** 環境名 */
  environment: string;
  /** AWS アカウントID */
  accountId: string;
  /** IAM ロール ARN */
  roleArn: string;
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** メタデータ */
  metadata?: Record<string, unknown>;
  /** ChatHistory テーブル名 */
  chatHistoryTableName: string;
  /** TokenUsageStats テーブル名 */
  tokenUsageStatsTableName: string;
  /** UseCaseBuilder テーブル名 */
  useCaseBuilderTableName: string;
  /** Assistant テーブル名 */
  assistantTableName: string;
  /** Bot テーブル名 (v0.5.3 BotTableV3) */
  botTableName?: string;
}

/**
 * テーブル情報
 */
export interface TableInfo {
  /** テーブル名 */
  tableName: string;
  /** テーブル ARN */
  tableArn: string;
  /** テーブルステータス */
  tableStatus: string;
  /** アイテム数 */
  itemCount: number;
  /** テーブルサイズ (バイト) */
  tableSizeBytes: number;
  /** 作成日時 */
  createdAt: string;
}

// ============================================================================
// バックアップ結果型
// ============================================================================

/**
 * DynamoDB バックアップ結果
 */
export interface DynamoDBBackupResult {
  /** テーブル名 */
  tableName: string;
  /** バックアップ ARN */
  backupArn: string;
  /** バックアップ名 */
  backupName: string;
  /** バックアップステータス */
  backupStatus: string;
  /** 作成日時 */
  createdAt: string;
}

/**
 * SystemContext データ
 */
export interface SystemContextData {
  /** ID */
  id: string;
  /** 作成日時 */
  createdDate: string;
  /** SystemContext 設定 */
  systemContext: string;
  /** タイトル */
  title?: string;
  /** その他の属性 */
  [key: string]: unknown;
}

/**
 * SystemContext バックアップ
 */
export interface SystemContextBackup {
  /** テナントID (デフォルトの場合は 'default') */
  tenantId: string;
  /** テーブル名 */
  tableName: string;
  /** エクスポート日時 */
  exportedAt: string;
  /** アイテム数 */
  itemCount: number;
  /** SystemContext データ一覧 */
  items: SystemContextData[];
}

/**
 * バックアップマニフェスト
 */
export interface BackupManifest {
  /** 環境名 */
  environment: string;
  /** テナントID */
  tenantId: string;
  /** バックアップ日時 */
  createdAt: string;
  /** バックアップ一覧 */
  backups: {
    dynamodb: DynamoDBBackupResult[];
    exports: {
      systemContexts?: string;
      chatHistory?: string;
      tokenUsageStats?: string;
      useCaseBuilder?: string;
      /** Bot データ (v0.5.3 の BotTableV3) */
      bots?: string;
    };
  };
}

// ============================================================================
// 検証結果型
// ============================================================================

/**
 * テーブルカウント
 */
export interface TableCounts {
  /** テーブル名 */
  tableName: string;
  /** 総アイテム数 */
  totalItems: number;
  /** プレフィックス別カウント */
  prefixCounts: Record<string, number>;
  /** カウント日時 */
  countedAt: string;
}

/**
 * 整合性チェック結果
 */
export interface IntegrityCheckResult {
  /** チェック名 */
  checkName: string;
  /** 成功したか */
  passed: boolean;
  /** メッセージ */
  message: string;
  /** 詳細 */
  details?: Record<string, unknown>;
}

/**
 * 検証結果
 */
export interface VerificationResult {
  /** 環境名 */
  environment: string;
  /** テナントID */
  tenantId: string;
  /** 検証日時 */
  verifiedAt: string;
  /** テーブルカウント一覧 */
  tableCounts: TableCounts[];
  /** 整合性チェック結果一覧 */
  integrityChecks: IntegrityCheckResult[];
  /** 全体の成功状態 */
  overallPassed: boolean;
}

// ============================================================================
// レポート型
// ============================================================================

/**
 * 移行結果サマリー
 */
export interface MigrationSummary {
  /** 環境数 */
  environmentCount: number;
  /** テナント数 */
  tenantCount: number;
  /** バックアップ数 */
  backupCount: number;
  /** 成功数 */
  successCount: number;
  /** 失敗数 */
  failureCount: number;
  /** 警告数 */
  warningCount: number;
}

/**
 * 移行結果
 */
export interface MigrationResults {
  /** 設定 */
  config: MigrationConfig;
  /** 実行日時 */
  executedAt: string;
  /** 完了日時 */
  completedAt?: string;
  /** 検出された環境一覧 */
  environments: DiscoveredEnvironment[];
  /** 検出されたテナント一覧 */
  tenants: DiscoveredTenant[];
  /** バックアップマニフェスト一覧 */
  backupManifests: BackupManifest[];
  /** 検証結果一覧 */
  verificationResults: VerificationResult[];
  /** サマリー */
  summary: MigrationSummary;
  /** エラー一覧 */
  errors: MigrationError[];
}

/**
 * 移行エラー
 */
export interface MigrationError {
  /** フェーズ */
  phase: 'discovery' | 'backup' | 'verification' | 'report';
  /** 環境名 */
  environment?: string;
  /** テナントID */
  tenantId?: string;
  /** エラーメッセージ */
  message: string;
  /** エラー詳細 */
  error?: unknown;
  /** 発生日時 */
  occurredAt: string;
}

/**
 * 移行レポート
 */
export interface MigrationReport {
  /** レポートタイトル */
  title: string;
  /** 生成日時 */
  generatedAt: string;
  /** 結果 */
  results: MigrationResults;
  /** Markdown形式のレポート本文 */
  markdown: string;
}

// ============================================================================
// CLI オプション型
// ============================================================================

/**
 * 共通CLI オプション
 */
export interface CommonCliOptions {
  /** リージョン */
  region?: string;
  /** プロファイル */
  profile?: string;
  /** 詳細ログ */
  verbose?: boolean;
}

/**
 * Discover コマンドオプション
 */
export interface DiscoverOptions extends CommonCliOptions {
  /** 出力ファイル */
  output?: string;
}

/**
 * Backup コマンドオプション
 */
export interface BackupOptions extends CommonCliOptions {
  /** 設定ファイルパス */
  config: string;
  /** ドライラン */
  dryRun?: boolean;
}

/**
 * Verify コマンドオプション
 */
export interface VerifyOptions extends CommonCliOptions {
  /** 設定ファイルパス */
  config: string;
}

/**
 * Report コマンドオプション
 */
export interface ReportOptions extends CommonCliOptions {
  /** 設定ファイルパス */
  config: string;
  /** 出力ディレクトリ */
  output?: string;
}

/**
 * Full コマンドオプション
 */
export interface FullOptions extends CommonCliOptions {
  /** 設定ファイルパス */
  config: string;
  /** 出力ディレクトリ */
  output: string;
  /** ドライラン */
  dryRun?: boolean;
}
