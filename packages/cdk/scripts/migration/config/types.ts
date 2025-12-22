/**
 * 移行設定の型定義
 * v0.5.3 → develop 移行自動化スクリプト用
 */

// =============================================================================
// 設定ファイル型
// =============================================================================

/**
 * 環境設定
 */
export interface EnvironmentConfig {
  /** 環境名 (例: dev, prod) */
  name: string;
  /** AWS リージョン */
  region: string;
  /** AWS プロファイル名 (ローカル実行時) */
  awsProfile?: string;
  /** 除外するテナントID一覧 */
  excludeTenants?: string[];
  /** テナントテーブル名のオーバーライド */
  tenantsTableName?: string;
}

/**
 * テーブルバックアップ設定
 */
export interface TableBackupSettings {
  /** オンデマンドバックアップを作成するか */
  createOnDemandBackups: boolean;
  /** JSONエクスポートを行うか */
  exportToJson: boolean;
  /** データ種別ごとのエクスポート設定 */
  includeData: {
    systemContexts: boolean;
    chatHistory: boolean;
    tokenUsageStats: boolean;
    useCaseBuilder: boolean;
  };
}

/**
 * 移行設定
 */
export interface MigrationSettings {
  /** ドライラン（実際の変更を行わない） */
  dryRun: boolean;
  /** 出力ディレクトリ */
  outputDir: string;
  /** 並列処理数 */
  parallelism: number;
  /** テーブルバックアップ設定 */
  tables: TableBackupSettings;
}

/**
 * 設定ファイル全体の型
 */
export interface MigrationConfig {
  /** 移行元バージョン */
  sourceVersion: string;
  /** 移行先バージョン */
  targetVersion: string;
  /** 環境一覧 */
  environments: EnvironmentConfig[];
  /** 設定 */
  settings: MigrationSettings;
}

// =============================================================================
// 検出結果型
// =============================================================================

/**
 * 検出された環境情報
 */
export interface DiscoveredEnvironment {
  /** 環境名 */
  name: string;
  /** AWS リージョン */
  region: string;
  /** CloudFormation スタック名 */
  stackName: string;
  /** テナントテーブル名 */
  tenantsTableName?: string;
  /** ChatHistory テーブル名 (デフォルトテナント用) */
  chatHistoryTableName?: string;
  /** TokenUsageStats テーブル名 (デフォルトテナント用) */
  tokenUsageStatsTableName?: string;
  /** UseCaseBuilder テーブル名 (デフォルトテナント用) */
  useCaseBuilderTableName?: string;
  /** デプロイ日時 */
  deployedAt?: string;
  /** スタックステータス */
  status: string;
}

/**
 * テナントステータス
 */
export enum TenantStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROVISIONING = 'provisioning',
  ERROR = 'error',
}

/**
 * 検出されたテナント情報
 */
export interface DiscoveredTenant {
  /** テナントID */
  tenantId: string;
  /** テナントステータス */
  status: TenantStatus;
  /** AWS リージョン */
  region: string;
  /** 環境名 */
  environment: string;
  /** AWS アカウントID */
  accountId: string;
  /** IAM ロールARN */
  roleArn: string;
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** ChatHistory テーブル名 */
  chatHistoryTableName: string;
  /** TokenUsageStats テーブル名 */
  tokenUsageStatsTableName: string;
  /** UseCaseBuilder テーブル名 */
  useCaseBuilderTableName: string;
  /** メタデータ */
  metadata?: Record<string, unknown>;
}

/**
 * 検出されたテーブル情報
 */
export interface DiscoveredTable {
  /** テーブル名 */
  tableName: string;
  /** テーブルARN */
  tableArn: string;
  /** テーブルステータス */
  status: string;
  /** アイテム数 */
  itemCount: number;
  /** テーブルサイズ（バイト） */
  tableSizeBytes: number;
  /** 作成日時 */
  createdAt: Date;
  /** 最終更新日時 */
  lastUpdatedAt?: Date;
  /** バックアップ可能か */
  canBackup: boolean;
}

// =============================================================================
// バックアップ結果型
// =============================================================================

/**
 * SystemContext バックアップアイテム
 */
export interface SystemContextBackupItem {
  /** パーティションキー (systemContext#userId) */
  id: string;
  /** 作成日時 */
  createdDate: string;
  /** SystemContext ID */
  systemContextId: string;
  /** SystemContext 内容 */
  systemContext: string;
  /** SystemContext タイトル */
  systemContextTitle: string;
}

/**
 * SystemContext バックアップ結果
 */
export interface SystemContextBackup {
  /** テナントID (default はデフォルトテナント) */
  tenantId: string;
  /** 環境名 */
  environment: string;
  /** テーブル名 */
  tableName: string;
  /** エクスポート日時 */
  exportedAt: string;
  /** アイテム数 */
  itemCount: number;
  /** アイテム一覧 */
  items: SystemContextBackupItem[];
}

/**
 * DynamoDB オンデマンドバックアップ結果
 */
export interface DynamoDBBackupResult {
  /** テーブル名 */
  tableName: string;
  /** バックアップARN */
  backupArn: string;
  /** バックアップ名 */
  backupName: string;
  /** バックアップ状態 */
  backupStatus: string;
  /** 作成日時 */
  createdAt: Date;
}

/**
 * JSON エクスポート結果
 */
export interface JsonExportResult {
  /** テーブル名 */
  tableName: string;
  /** エクスポートファイルパス */
  filePath: string;
  /** レコード数 */
  recordCount: number;
  /** ファイルサイズ（バイト） */
  fileSizeBytes: number;
  /** エクスポート日時 */
  exportedAt: string;
}

/**
 * バックアップマニフェスト
 */
export interface BackupManifest {
  /** テナントID */
  tenantId: string;
  /** 環境名 */
  environment: string;
  /** バックアップ日時 */
  createdAt: string;
  /** オンデマンドバックアップ一覧 */
  dynamoDbBackups: DynamoDBBackupResult[];
  /** JSONエクスポート一覧 */
  jsonExports: JsonExportResult[];
}

// =============================================================================
// 検証結果型
// =============================================================================

/**
 * プレフィックス別カウント
 */
export interface PrefixCounts {
  /** user# プレフィックス */
  user: number;
  /** chat# プレフィックス */
  chat: number;
  /** systemContext# プレフィックス */
  systemContext: number;
  /** stats# プレフィックス */
  stats: number;
  /** その他 */
  other: number;
}

/**
 * テーブルカウント結果
 */
export interface TableCounts {
  /** テーブル名 */
  tableName: string;
  /** 総レコード数 */
  totalCount: number;
  /** プレフィックス別カウント (ChatHistoryテーブルのみ) */
  prefixCounts?: PrefixCounts;
  /** カウント日時 */
  countedAt: string;
}

/**
 * データ整合性チェック結果
 */
export interface IntegrityCheckResult {
  /** テーブル名 */
  tableName: string;
  /** チェック日時 */
  checkedAt: string;
  /** 問題の有無 */
  hasIssues: boolean;
  /** 問題一覧 */
  issues: IntegrityIssue[];
}

/**
 * 整合性問題
 */
export interface IntegrityIssue {
  /** 問題の種類 */
  type: 'missing_field' | 'invalid_format' | 'orphan_record' | 'duplicate';
  /** 問題の説明 */
  description: string;
  /** 影響を受けるレコード数 */
  affectedCount: number;
  /** サンプルレコードID */
  sampleRecordIds?: string[];
}

// =============================================================================
// レポート型
// =============================================================================

/**
 * 環境サマリー
 */
export interface EnvironmentSummary {
  /** 環境名 */
  environment: string;
  /** リージョン */
  region: string;
  /** テナント数 */
  tenantCount: number;
  /** テーブル数 */
  tableCount: number;
  /** 総レコード数 */
  totalRecords: number;
  /** バックアップ成功数 */
  backupsSucceeded: number;
  /** バックアップ失敗数 */
  backupsFailed: number;
}

/**
 * 移行結果全体
 */
export interface MigrationResults {
  /** 実行ID */
  executionId: string;
  /** 開始日時 */
  startedAt: string;
  /** 完了日時 */
  completedAt?: string;
  /** 設定 */
  config: MigrationConfig;
  /** 検出された環境 */
  environments: DiscoveredEnvironment[];
  /** 検出されたテナント */
  tenants: DiscoveredTenant[];
  /** バックアップマニフェスト */
  backups: BackupManifest[];
  /** テーブルカウント */
  tableCounts: TableCounts[];
  /** 整合性チェック結果 */
  integrityChecks: IntegrityCheckResult[];
  /** 環境サマリー */
  summaries: EnvironmentSummary[];
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
  /** スタックトレース */
  stack?: string;
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
  /** Markdown コンテンツ */
  markdownContent: string;
  /** JSON データ */
  jsonData: MigrationResults;
}

// =============================================================================
// AWS クライアント関連型
// =============================================================================

/**
 * AWS クライアント設定
 */
export interface AWSClientConfig {
  region: string;
  profile?: string;
  credentials?: AWSCredentials;
}

/**
 * AWS クレデンシャル
 */
export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * クロスアカウントアクセス設定
 */
export interface CrossAccountConfig {
  /** ターゲットアカウントID */
  accountId: string;
  /** AssumeするロールARN */
  roleArn: string;
  /** セッション名 */
  sessionName: string;
  /** 外部ID (オプション) */
  externalId?: string;
}

// =============================================================================
// CLI オプション型
// =============================================================================

/**
 * discover コマンドオプション
 */
export interface DiscoverOptions {
  region: string;
  profile?: string;
  output?: string;
}

/**
 * backup コマンドオプション
 */
export interface BackupOptions {
  config: string;
  dryRun?: boolean;
  output?: string;
}

/**
 * verify コマンドオプション
 */
export interface VerifyOptions {
  config: string;
  output?: string;
}

/**
 * report コマンドオプション
 */
export interface ReportOptions {
  config: string;
  resultsDir: string;
  output?: string;
}

/**
 * full コマンドオプション
 */
export interface FullOptions {
  config: string;
  output: string;
  dryRun?: boolean;
}

// =============================================================================
// 進捗管理型
// =============================================================================

/**
 * 進捗状態
 */
export interface ProgressState {
  /** 現在のフェーズ */
  phase: 'discovery' | 'backup' | 'verification' | 'report';
  /** 総タスク数 */
  total: number;
  /** 完了タスク数 */
  completed: number;
  /** 現在のタスク */
  currentTask?: string;
  /** 開始日時 */
  startedAt: Date;
  /** エラー数 */
  errorCount: number;
}
