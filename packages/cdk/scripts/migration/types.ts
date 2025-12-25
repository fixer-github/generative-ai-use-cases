/**
 * Migration Types
 * v0.5.3 -> develop 移行スクリプトの型定義
 */

import { AwsCredentialIdentity, Provider } from '@aws-sdk/types';

// ============================================================================
// AWS 設定
// ============================================================================

/**
 * AWS クライアント設定
 */
export interface AWSClientConfig {
  region: string;
  profile?: string;
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
}

// ============================================================================
// Bot 関連 (v0.5.3)
// ============================================================================

/**
 * v0.5.3 BotTableV3 の Bot アイテム
 */
export interface V053Bot {
  PK: string; // UserId
  SK: string; // BOT#{bot_id}
  ItemType?: string;
  BotId: string;
  Title: string;
  Description?: string;
  Instruction?: string;
  CreateTime?: number;
  LastUsedTime?: number;
  SharedScope?: 'private' | 'partial' | 'all';
  SharedStatus?: string;
  SyncStatus?: string;
  SyncStatusReason?: string;
  Knowledge?: {
    filenames?: string[];
    source_urls?: string[];
    sitemap_urls?: string[];
    s3_urls?: string[];
  };
  ConversationQuickStarters?: Array<{ title: string; example?: string }>;
  BedrockKnowledgeBase?: Record<string, unknown>;
}

// ============================================================================
// Assistant 関連 (develop)
// ============================================================================

/**
 * develop の Assistant 形式
 */
export interface AssistantItem {
  id: string; // duplicated userId (for backward compatibility)
  createdDate: string; // sort key (Unix timestamp as string)
  assistantId: string;
  userId: string; // partition key (user#uuid format)
  tenantId: string;
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  visibility: 'private' | 'public';
  syncStatus: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL';
  syncStatusReason: string;
  knowledgeSources: KnowledgeSource[];
  firstQuestions?: string[];
  s3Urls?: string[];
  updatedDate: string;
}

/**
 * Knowledge ソース
 */
export interface KnowledgeSource {
  id: string;
  type: 'file' | 'web' | 'url';
  name: string;
  displayName?: string;
  storageKey?: string;
  sourceUrl?: string;
  status: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';
}

// ============================================================================
// S3 マッピング
// ============================================================================

/**
 * S3 コピーマッピング
 */
export interface S3CopyMapping {
  sourceKey: string;
  targetKey: string;
  fileName: string;
  fileId: string;
  botId: string;
  userId: string;
}

// ============================================================================
// 変換結果
// ============================================================================

/**
 * Bot → Assistant 変換結果
 */
export interface TransformResult {
  assistants: AssistantItem[];
  s3Mappings: S3CopyMapping[];
  botIdToAssistantId: Record<string, string>;
  statistics: TransformStatistics;
}

/**
 * 変換統計
 */
export interface TransformStatistics {
  totalBots: number;
  transformedAssistants: number;
  totalFiles: number;
  totalUrls: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// インポート統計
// ============================================================================

/**
 * DynamoDB インポート統計
 */
export interface ImportStatistics {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * S3 コピー統計
 */
export interface CopyStatistics {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ============================================================================
// エクスポート結果
// ============================================================================

/**
 * Bot エクスポート結果
 */
export interface ExportResult {
  tableName: string;
  outputPath: string;
  itemCount: number;
  exportedAt: string;
}

/**
 * S3 バックアップ結果
 */
export interface S3BackupResult {
  bucketName: string;
  outputDir: string;
  totalFiles: number;
  downloadedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  errors: string[];
  exportedAt: string;
}
