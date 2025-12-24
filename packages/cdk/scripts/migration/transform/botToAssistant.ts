#!/usr/bin/env node

/**
 * Bot -> Assistant Transform Script
 * v0.5.3 の BotTableV3 データを develop の Assistant 形式に変換
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * v0.5.3 BotTableV3 の Bot アイテム
 */
interface V053Bot {
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
  // その他のフィールドは必要に応じて追加
}

/**
 * develop の Assistant 形式
 */
interface AssistantItem {
  id: string; // userId - partition key
  createdDate: string; // sort key
  assistantId: string;
  userId: string;
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

interface KnowledgeSource {
  id: string;
  type: 'file' | 'web' | 'url';
  name: string;
  displayName?: string;
  storageKey?: string;
  sourceUrl?: string;
  status: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';
}

/**
 * S3 コピーマッピング
 */
interface S3CopyMapping {
  sourceKey: string;
  targetKey: string;
  fileName: string;
  fileId: string;
  botId: string;
  userId: string;
}

/**
 * 変換結果
 */
interface TransformResult {
  assistants: AssistantItem[];
  s3Mappings: S3CopyMapping[];
  botIdToAssistantId: Record<string, string>;
  statistics: {
    totalBots: number;
    transformedAssistants: number;
    totalFiles: number;
    totalUrls: number;
    skipped: number;
    errors: string[];
  };
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * ファイル名をサニタイズ
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * SharedScope を visibility に変換
 */
function convertVisibility(sharedScope?: string): 'private' | 'public' {
  return sharedScope === 'all' ? 'public' : 'private';
}

/**
 * Bot の Knowledge を KnowledgeSources に変換
 */
function convertKnowledgeSources(
  knowledge: V053Bot['Knowledge'],
  userId: string,
  s3Mappings: S3CopyMapping[],
  botId: string
): KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];

  // ファイルの変換
  if (knowledge?.filenames) {
    for (const filename of knowledge.filenames) {
      const fileId = randomUUID();
      const sanitizedName = sanitizeFileName(filename);
      const storageKey = `assistant-files/${userId}/${fileId}/${sanitizedName}`;

      sources.push({
        id: randomUUID(),
        type: 'file',
        name: filename,
        displayName: filename,
        storageKey,
        status: 'QUEUED',
      });

      // S3 コピーマッピングを追加
      s3Mappings.push({
        sourceKey: `${userId}/${botId}/documents/${filename}`,
        targetKey: storageKey,
        fileName: filename,
        fileId,
        botId,
        userId,
      });
    }
  }

  // URL の変換
  if (knowledge?.source_urls) {
    for (const url of knowledge.source_urls) {
      try {
        const hostname = new URL(url).hostname;
        sources.push({
          id: randomUUID(),
          type: 'web',
          name: hostname,
          displayName: url,
          sourceUrl: url,
          status: 'QUEUED',
        });
      } catch {
        // Invalid URL - skip
        console.warn(`Invalid URL skipped: ${url}`);
      }
    }
  }

  return sources;
}

/**
 * ConversationQuickStarters を firstQuestions に変換
 */
function convertFirstQuestions(
  quickStarters?: Array<{ title: string; example?: string }>
): string[] | undefined {
  if (!quickStarters || quickStarters.length === 0) {
    return undefined;
  }
  return quickStarters.map((q) => q.title);
}

/**
 * 単一の Bot を Assistant に変換
 */
function transformBot(
  bot: V053Bot,
  tenantId: string,
  defaultModelId: string,
  s3Mappings: S3CopyMapping[]
): AssistantItem | null {
  // SK が BOT# で始まらない場合はスキップ（ALIASなど）
  if (!bot.SK.startsWith('BOT#')) {
    return null;
  }

  const userId = bot.PK;
  const botId = bot.BotId || bot.SK.replace('BOT#', '');
  const now = new Date().toISOString();
  const assistantId = `assistant#${randomUUID()}`;

  const knowledgeSources = convertKnowledgeSources(
    bot.Knowledge,
    userId,
    s3Mappings,
    botId
  );

  const hasKnowledge = knowledgeSources.length > 0;

  return {
    id: `user#${userId}`,
    createdDate: bot.CreateTime
      ? new Date(bot.CreateTime).toISOString()
      : now,
    assistantId,
    userId: `user#${userId}`,
    tenantId: `tenant#${tenantId}`,
    name: bot.Title || 'Untitled Assistant',
    description: bot.Description || '',
    instruction: bot.Instruction || '',
    modelId: defaultModelId,
    ragEnabled: hasKnowledge,
    visibility: convertVisibility(bot.SharedScope),
    syncStatus: hasKnowledge ? 'QUEUED' : 'SUCCEEDED',
    syncStatusReason: '',
    knowledgeSources,
    firstQuestions: convertFirstQuestions(bot.ConversationQuickStarters),
    updatedDate: now,
  };
}

/**
 * Bot 一覧を Assistant 一覧に変換
 */
export function transformBots(
  bots: V053Bot[],
  tenantId: string,
  defaultModelId: string = 'anthropic.claude-3-5-sonnet-20241022-v2:0'
): TransformResult {
  const assistants: AssistantItem[] = [];
  const s3Mappings: S3CopyMapping[] = [];
  const botIdToAssistantId: Record<string, string> = {};
  const errors: string[] = [];
  let skipped = 0;
  let totalFiles = 0;
  let totalUrls = 0;

  for (const bot of bots) {
    try {
      const assistant = transformBot(bot, tenantId, defaultModelId, s3Mappings);
      if (assistant) {
        assistants.push(assistant);
        const botId = bot.BotId || bot.SK.replace('BOT#', '');
        botIdToAssistantId[botId] = assistant.assistantId;

        // 統計
        totalFiles += assistant.knowledgeSources.filter(
          (s) => s.type === 'file'
        ).length;
        totalUrls += assistant.knowledgeSources.filter(
          (s) => s.type === 'web'
        ).length;
      } else {
        skipped++;
      }
    } catch (error) {
      const botId = bot.BotId || bot.SK;
      errors.push(`Failed to transform bot ${botId}: ${error}`);
    }
  }

  return {
    assistants,
    s3Mappings,
    botIdToAssistantId,
    statistics: {
      totalBots: bots.length,
      transformedAssistants: assistants.length,
      totalFiles,
      totalUrls,
      skipped,
      errors,
    },
  };
}

// ============================================================================
// CLI
// ============================================================================

interface CliOptions {
  input: string;
  output: string;
  tenantId: string;
  modelId?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-i':
      case '--input':
        options.input = args[++i];
        break;
      case '-o':
      case '--output':
        options.output = args[++i];
        break;
      case '-t':
      case '--tenant-id':
        options.tenantId = args[++i];
        break;
      case '-m':
      case '--model-id':
        options.modelId = args[++i];
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!options.input || !options.output || !options.tenantId) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }

  return options as CliOptions;
}

function printHelp(): void {
  console.log(`
Bot to Assistant Transform Script

Usage:
  npx ts-node transform/botToAssistant.ts [options]

Options:
  -i, --input <path>      Input JSON file (DynamoDB scan result)
  -o, --output <path>     Output directory
  -t, --tenant-id <id>    Tenant ID
  -m, --model-id <id>     Default model ID (optional)
  -h, --help              Show help

Example:
  npx ts-node transform/botToAssistant.ts \\
    -i ./backup/bots.json \\
    -o ./output \\
    -t my-tenant
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('=== Bot to Assistant Transform ===');
  console.log(`Input: ${options.input}`);
  console.log(`Output: ${options.output}`);
  console.log(`Tenant ID: ${options.tenantId}`);

  // 入力ファイルを読み込み
  const inputData = JSON.parse(fs.readFileSync(options.input, 'utf-8'));

  // DynamoDB scan 結果の場合、Items を抽出
  const bots: V053Bot[] = inputData.Items || inputData;

  console.log(`\nFound ${bots.length} items in input file`);

  // 変換実行
  const result = transformBots(bots, options.tenantId, options.modelId);

  // 出力ディレクトリを作成
  if (!fs.existsSync(options.output)) {
    fs.mkdirSync(options.output, { recursive: true });
  }

  // 結果を保存
  const assistantsPath = path.join(options.output, 'assistants.json');
  const s3MappingsPath = path.join(options.output, 's3-mappings.json');
  const idMappingPath = path.join(options.output, 'id-mapping.json');
  const statsPath = path.join(options.output, 'transform-stats.json');

  fs.writeFileSync(assistantsPath, JSON.stringify(result.assistants, null, 2));
  fs.writeFileSync(s3MappingsPath, JSON.stringify(result.s3Mappings, null, 2));
  fs.writeFileSync(
    idMappingPath,
    JSON.stringify(result.botIdToAssistantId, null, 2)
  );
  fs.writeFileSync(
    statsPath,
    JSON.stringify(result.statistics, null, 2)
  );

  // 統計を表示
  console.log('\n=== Transform Statistics ===');
  console.log(`Total Bots: ${result.statistics.totalBots}`);
  console.log(`Transformed Assistants: ${result.statistics.transformedAssistants}`);
  console.log(`Total Files: ${result.statistics.totalFiles}`);
  console.log(`Total URLs: ${result.statistics.totalUrls}`);
  console.log(`Skipped: ${result.statistics.skipped}`);

  if (result.statistics.errors.length > 0) {
    console.log(`\nErrors (${result.statistics.errors.length}):`);
    result.statistics.errors.forEach((e) => console.log(`  - ${e}`));
  }

  console.log('\n=== Output Files ===');
  console.log(`Assistants: ${assistantsPath}`);
  console.log(`S3 Mappings: ${s3MappingsPath}`);
  console.log(`ID Mapping: ${idMappingPath}`);
  console.log(`Statistics: ${statsPath}`);

  console.log('\nTransform completed successfully!');
}

// 直接実行された場合のみ main() を呼び出す
if (require.main === module) {
  main().catch((error) => {
    console.error('Transform failed:', error);
    process.exit(1);
  });
}
