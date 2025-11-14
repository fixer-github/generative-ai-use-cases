import { Assistant } from 'generative-ai-use-cases';
import { OldBot } from '../types/old-schema';
import {
  transformKnowledgeSources,
  validateKnowledgeSourceTransformation,
} from './knowledge';
import * as crypto from 'crypto';

export type AssistantTransformOptions = {
  defaultTenantId: string;
  tenantExtractor?: (userId: string) => string;
  defaultModelId?: string;
  preserveLegacyS3Urls?: boolean;
};

/**
 * Extract tenant ID from user ID pattern
 * Supports patterns like: "tenant#xxx#user#yyy" or just "user#yyy"
 */
export function extractTenantFromUserId(
  userId: string,
  defaultTenantId: string
): string {
  const tenantMatch = userId.match(/^tenant#([^#]+)#/);
  if (tenantMatch) {
    return tenantMatch[1];
  }
  return defaultTenantId;
}

/**
 * Map old SyncStatus to new syncStatus
 */
function mapSyncStatus(
  oldStatus: string
): 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' {
  const normalized = oldStatus.toUpperCase();
  switch (normalized) {
    case 'QUEUED':
      return 'QUEUED';
    case 'SYNCING':
      return 'SYNCING';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
      return 'FAILED';
    case 'PARTIAL':
      return 'PARTIAL';
    default:
      console.warn(`Unknown sync status: ${oldStatus}, defaulting to QUEUED`);
      return 'QUEUED';
  }
}

/**
 * Map old SharedStatus to new visibility
 */
function mapVisibility(
  oldSharedStatus: string,
  oldSharedScope?: string
): 'private' | 'public' {
  const normalized = oldSharedStatus.toLowerCase();

  // If explicitly private
  if (normalized === 'private' || !oldSharedScope) {
    return 'private';
  }

  // If shared within scope (tenant/org)
  if (
    normalized === 'shared' ||
    normalized === 'public' ||
    oldSharedScope === 'tenant' ||
    oldSharedScope === 'organization'
  ) {
    return 'public';
  }

  return 'private';
}

/**
 * Determine default model ID from old bot data
 */
function determineModelId(
  oldBot: OldBot,
  defaultModelId: string = 'anthropic.claude-v2'
): string {
  // Check ActiveModels for the first active model
  if (oldBot.ActiveModels) {
    for (const [modelName, isActive] of Object.entries(oldBot.ActiveModels)) {
      if (isActive) {
        return modelName;
      }
    }
  }

  // Fallback to default
  return defaultModelId;
}

/**
 * Transform old Bot to new Assistant
 */
export function transformBotToAssistant(
  oldBot: OldBot,
  options: AssistantTransformOptions
): Assistant {
  // Extract user ID from PK
  const userId = `user#${oldBot.PK}`;

  // Determine tenant ID
  const tenantId = options.tenantExtractor
    ? options.tenantExtractor(userId)
    : extractTenantFromUserId(userId, options.defaultTenantId);

  // Transform knowledge sources
  // Note: KnowledgeSource status doesn't support PARTIAL, so map to FAILED
  const mappedStatus = mapSyncStatus(oldBot.SyncStatus);
  const knowledgeSourceStatus: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED' =
    mappedStatus === 'PARTIAL' ? 'FAILED' : mappedStatus;

  const knowledgeSources = transformKnowledgeSources(oldBot.Knowledge, {
    defaultStatus: knowledgeSourceStatus,
  });

  // Determine model ID
  const modelId = determineModelId(oldBot, options.defaultModelId);

  // Create timestamps
  const createdDate = new Date(oldBot.CreateTime * 1000).toISOString();
  const updatedDate = oldBot.LastUsedTime
    ? new Date(oldBot.LastUsedTime * 1000).toISOString()
    : createdDate;

  // Map visibility
  const visibility = mapVisibility(oldBot.SharedStatus, oldBot.SharedScope);

  // Determine if RAG is enabled
  const ragEnabled =
    knowledgeSources.length > 0 || Boolean(oldBot.BedrockKnowledgeBase);

  // Create the new assistant
  const assistant: Assistant = {
    id: userId,
    createdDate,
    assistantId: oldBot.BotId.startsWith('assistant#')
      ? oldBot.BotId
      : `assistant#${oldBot.BotId}`,
    userId,
    tenantId,
    name: oldBot.Title,
    description: oldBot.Description || '',
    instruction: oldBot.Instruction || '',
    modelId,
    ragEnabled,
    visibility,
    syncStatus: mapSyncStatus(oldBot.SyncStatus),
    syncStatusReason: oldBot.SyncStatusReason || '',
    knowledgeSources,
    updatedDate,
  };

  // Optionally preserve legacy s3_urls field
  if (options.preserveLegacyS3Urls && oldBot.Knowledge?.s3_urls) {
    assistant.s3Urls = oldBot.Knowledge.s3_urls;
  }

  return assistant;
}

/**
 * Validate assistant transformation
 */
export function validateAssistantTransformation(
  oldBot: OldBot,
  newAssistant: Assistant
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate required fields
  if (!newAssistant.id) errors.push('Missing id');
  if (!newAssistant.createdDate) errors.push('Missing createdDate');
  if (!newAssistant.assistantId) errors.push('Missing assistantId');
  if (!newAssistant.userId) errors.push('Missing userId');
  if (!newAssistant.tenantId) errors.push('Missing tenantId');
  if (!newAssistant.name) errors.push('Missing name');
  if (!newAssistant.modelId) errors.push('Missing modelId');
  if (!newAssistant.syncStatus) errors.push('Missing syncStatus');
  if (!newAssistant.visibility) errors.push('Missing visibility');

  // Validate name matches
  if (newAssistant.name !== oldBot.Title) {
    errors.push(
      `Name mismatch: expected "${oldBot.Title}", got "${newAssistant.name}"`
    );
  }

  // Validate knowledge sources transformation
  const knowledgeValidation = validateKnowledgeSourceTransformation(
    oldBot.Knowledge,
    newAssistant.knowledgeSources
  );
  if (!knowledgeValidation.valid) {
    errors.push(...knowledgeValidation.errors);
  }

  // Validate RAG enabled matches knowledge sources
  if (newAssistant.ragEnabled && newAssistant.knowledgeSources.length === 0) {
    errors.push('RAG enabled but no knowledge sources present');
  }

  // Validate sync status
  if (
    !['QUEUED', 'SYNCING', 'SUCCEEDED', 'FAILED', 'PARTIAL'].includes(
      newAssistant.syncStatus
    )
  ) {
    errors.push(`Invalid syncStatus: ${newAssistant.syncStatus}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Batch transform multiple bots
 */
export function batchTransformBots(
  oldBots: OldBot[],
  options: AssistantTransformOptions
): {
  assistants: Assistant[];
  errors: Array<{ botId: string; error: string }>;
} {
  const assistants: Assistant[] = [];
  const errors: Array<{ botId: string; error: string }> = [];

  for (const oldBot of oldBots) {
    try {
      const assistant = transformBotToAssistant(oldBot, options);
      const validation = validateAssistantTransformation(oldBot, assistant);

      if (validation.valid) {
        assistants.push(assistant);
      } else {
        errors.push({
          botId: oldBot.BotId,
          error: `Validation failed: ${validation.errors.join(', ')}`,
        });
      }
    } catch (error) {
      errors.push({
        botId: oldBot.BotId,
        error: `Transform error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { assistants, errors };
}
