/**
 * Bot -> Assistant Transform
 * v0.5.3 の BotTableV3 データを develop の Assistant 形式に変換
 */

import { randomUUID } from 'crypto';
import {
  V053Bot,
  AssistantItem,
  KnowledgeSource,
  S3CopyMapping,
  TransformResult,
} from '../types';

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
  const now = Date.now().toString();
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
      ? new Date(bot.CreateTime).getTime().toString()
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
