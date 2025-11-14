import { Chat } from 'generative-ai-use-cases';
import {
  OldConversation,
  OldMessageMap,
  OldMessage,
  OldMessageContent,
  ParsedMessageMap,
} from '../types/old-schema';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';

export type ChatMessage = {
  id: string; // chatId - partition key
  createdDate: string; // messageId timestamp - sort key
  messageId: string; // full messageId: "timestamp#uuid"
  assistantId: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistantMessageSource[];
  metadata?: {
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
};

export type AssistantMessageSource = {
  sourceId: string;
  sourceType: 'file' | 'web';
  name?: string;
  url?: string;
  content: string;
  contentType: string;
  excerpt: string;
  sourceUrl?: string;
  storageKey?: string;
  s3Url?: string;
};

export type ChatTransformOptions = {
  defaultTenantId: string;
  tenantExtractor?: (userId: string) => string;
  s3Client?: S3Client;
  region?: string;
};

/**
 * Extract text content from old message content array
 */
function extractTextContent(content: OldMessageContent[]): string {
  const textParts: string[] = [];

  for (const item of content) {
    if (item.content_type === 'text') {
      textParts.push(item.body);
    } else if (item.content_type === 'tool_result' && typeof item.content === 'string') {
      textParts.push(item.content);
    }
  }

  return textParts.join('\n');
}

/**
 * Transform old used_chunks to new sources
 */
function transformUsedChunks(
  usedChunks: any[] | null | undefined
): AssistantMessageSource[] {
  if (!usedChunks || usedChunks.length === 0) {
    return [];
  }

  return usedChunks
    .map((chunk, index) => {
      if (!chunk.content) {
        return null;
      }

      const source: AssistantMessageSource = {
        sourceId: crypto.randomUUID(),
        sourceType: chunk.source?.startsWith('http') ? 'web' : 'file',
        content: chunk.content,
        contentType: chunk.content_type || 'text/plain',
        excerpt: chunk.content.substring(0, 200),
      };

      if (chunk.source) {
        if (chunk.source.startsWith('http')) {
          source.sourceUrl = chunk.source;
          source.url = chunk.source;
          try {
            source.name = new URL(chunk.source).hostname;
          } catch {
            source.name = chunk.source;
          }
        } else {
          source.storageKey = chunk.source;
          source.s3Url = chunk.source;
          source.name = chunk.source.split('/').pop() || chunk.source;
        }
      }

      return source;
    })
    .filter((s): s is AssistantMessageSource => s !== null);
}

/**
 * Parse MessageMap from S3
 */
async function fetchMessageMapFromS3(
  s3Path: string,
  s3Client: S3Client
): Promise<ParsedMessageMap> {
  // Parse s3://bucket/key format
  const match = s3Path.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid S3 path format: ${s3Path}`);
  }

  const [, bucket, key] = match;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);
  if (!response.Body) {
    throw new Error(`Empty response from S3: ${s3Path}`);
  }

  const bodyString = await response.Body.transformToString();
  return JSON.parse(bodyString) as ParsedMessageMap;
}

/**
 * Parse MessageMap from either inline JSON or S3
 */
export async function parseMessageMap(
  conversation: OldConversation,
  options: ChatTransformOptions
): Promise<ParsedMessageMap> {
  if (conversation.IsLargeMessage && conversation.LargeMessagePath) {
    if (!options.s3Client) {
      throw new Error('S3Client required for large messages but not provided');
    }
    return fetchMessageMapFromS3(conversation.LargeMessagePath, options.s3Client);
  }

  if (conversation.MessageMap) {
    return JSON.parse(conversation.MessageMap) as ParsedMessageMap;
  }

  // Empty conversation
  return {};
}

/**
 * Flatten message tree to sequential messages
 * Converts tree structure (parent/children) to linear array ordered by create_time
 */
function flattenMessageTree(messageMap: OldMessageMap): Array<{
  messageId: string;
  message: OldMessage;
}> {
  const messages: Array<{ messageId: string; message: OldMessage }> = [];

  for (const [messageId, message] of Object.entries(messageMap)) {
    messages.push({ messageId, message });
  }

  // Sort by create_time
  messages.sort((a, b) => a.message.create_time - b.message.create_time);

  return messages;
}

/**
 * Generate messageId in format: "timestamp#uuid"
 */
function generateMessageId(createTime: number): string {
  const timestamp = Math.floor(createTime * 1000); // Convert to milliseconds
  const uuid = crypto.randomUUID();
  return `${timestamp}#${uuid}`;
}

/**
 * Transform old conversation to new chat record
 */
export function transformConversationToChat(
  oldConversation: OldConversation,
  options: ChatTransformOptions
): Chat & { tenantId: string; assistantId?: string } {
  // Extract user ID from PK
  const userId = `user#${oldConversation.PK}`;

  // Determine tenant ID
  const tenantId = options.tenantExtractor
    ? options.tenantExtractor(userId)
    : options.defaultTenantId;

  // Extract conversation ID from SK: "{user_id}#CONV#{conversation_id}"
  const skMatch = oldConversation.SK.match(/#CONV#(.+)$/);
  const conversationId = skMatch ? skMatch[1] : oldConversation.SK;
  const chatId = conversationId.startsWith('chat#')
    ? conversationId
    : `chat#${conversationId}`;

  // Create timestamps
  const createdDate = new Date(oldConversation.CreateTime * 1000).toISOString();
  const updatedDate = createdDate; // Can be updated based on last message later

  // Create chat record
  const chat: Chat & { tenantId: string; assistantId?: string } = {
    id: userId,
    createdDate,
    chatId,
    usecase: oldConversation.BotId ? 'assistant' : 'chat', // If linked to bot, it's assistant usecase
    title: oldConversation.Title,
    updatedDate,
    tenantId,
  };

  // Link to assistant if BotId exists
  if (oldConversation.BotId) {
    chat.assistantId = oldConversation.BotId.startsWith('assistant#')
      ? oldConversation.BotId
      : `assistant#${oldConversation.BotId}`;
  }

  return chat;
}

/**
 * Transform old conversation messages to new message records
 */
export async function transformConversationMessages(
  oldConversation: OldConversation,
  chat: Chat & { tenantId: string; assistantId?: string },
  options: ChatTransformOptions
): Promise<ChatMessage[]> {
  // Parse message map
  const messageMap = await parseMessageMap(oldConversation, options);

  // Flatten message tree
  const flatMessages = flattenMessageTree(messageMap);

  // Transform each message
  const chatMessages: ChatMessage[] = [];

  for (const { messageId: oldMessageId, message } of flatMessages) {
    const messageId = generateMessageId(message.create_time);
    const createdDate = new Date(message.create_time * 1000).toISOString();

    const chatMessage: ChatMessage = {
      id: chat.chatId,
      createdDate,
      messageId,
      assistantId: chat.assistantId || '', // Empty string if no assistant
      chatId: chat.chatId,
      userId: chat.id,
      role: message.role,
      content: extractTextContent(message.content),
      sources: transformUsedChunks(message.used_chunks),
    };

    chatMessages.push(chatMessage);
  }

  return chatMessages;
}

/**
 * Validate chat transformation
 */
export function validateChatTransformation(
  oldConversation: OldConversation,
  newChat: Chat
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate required fields
  if (!newChat.id) errors.push('Missing id');
  if (!newChat.createdDate) errors.push('Missing createdDate');
  if (!newChat.chatId) errors.push('Missing chatId');
  if (!newChat.usecase) errors.push('Missing usecase');
  if (!newChat.title) errors.push('Missing title');

  // Validate title matches
  if (newChat.title !== oldConversation.Title) {
    errors.push(
      `Title mismatch: expected "${oldConversation.Title}", got "${newChat.title}"`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Batch transform multiple conversations
 */
export async function batchTransformConversations(
  oldConversations: OldConversation[],
  options: ChatTransformOptions
): Promise<{
  chats: Array<Chat & { tenantId: string; assistantId?: string }>;
  messages: ChatMessage[];
  errors: Array<{ conversationId: string; error: string }>;
}> {
  const chats: Array<Chat & { tenantId: string; assistantId?: string }> = [];
  const messages: ChatMessage[] = [];
  const errors: Array<{ conversationId: string; error: string }> = [];

  for (const oldConversation of oldConversations) {
    try {
      const chat = transformConversationToChat(oldConversation, options);
      const validation = validateChatTransformation(oldConversation, chat);

      if (!validation.valid) {
        errors.push({
          conversationId: oldConversation.SK,
          error: `Validation failed: ${validation.errors.join(', ')}`,
        });
        continue;
      }

      const chatMessages = await transformConversationMessages(
        oldConversation,
        chat,
        options
      );

      chats.push(chat);
      messages.push(...chatMessages);
    } catch (error) {
      errors.push({
        conversationId: oldConversation.SK,
        error: `Transform error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { chats, messages, errors };
}
