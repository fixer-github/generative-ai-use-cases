/**
 * Tenant-aware repository wrapper
 * This provides a cleaner API that doesn't require passing the event to every function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';
import {
  Chat,
  SystemContext,
  ToBeRecordedMessage,
  RecordedMessage,
  UpdateFeedbackRequest,
  ShareId,
  UserIdAndChatId,
  TokenUsageStats,
  ListChatsResponse,
} from 'generative-ai-use-cases';

/**
 * Base repository interface for type safety
 */
interface IRepository {
  createChat(userId: string): Promise<Chat>;
  findChatById(userId: string, chatId: string): Promise<Chat | null>;
  listChats(userId: string, exclusiveStartKey?: string): Promise<ListChatsResponse>;
  setChatTitle(id: string, createdDate: string, title: string): Promise<Chat>;
  deleteChat(userId: string, chatId: string): Promise<void>;
  findSystemContextById(userId: string, systemContextId: string): Promise<SystemContext | null>;
  listSystemContexts(userId: string): Promise<SystemContext[]>;
  createSystemContext(userId: string, title: string, systemContext: string): Promise<SystemContext>;
  updateSystemContextTitle(userId: string, systemContextId: string, title: string): Promise<SystemContext>;
  deleteSystemContext(userId: string, systemContextId: string): Promise<void>;
  listMessages(chatId: string): Promise<RecordedMessage[]>;
  batchCreateMessages(messages: ToBeRecordedMessage[], userId: string, chatId: string): Promise<RecordedMessage[]>;
  updateFeedback(chatId: string, feedbackData: UpdateFeedbackRequest): Promise<RecordedMessage>;
  createShareId(userId: string, chatId: string): Promise<{ shareId: ShareId; userIdAndChatId: UserIdAndChatId }>;
  findUserIdAndChatId(shareId: string): Promise<UserIdAndChatId | null>;
  findShareId(userId: string, chatId: string): Promise<ShareId | null>;
  deleteShareId(shareId: string): Promise<void>;
  aggregateTokenUsage(startDate: string, endDate: string, userIds?: string[]): Promise<TokenUsageStats[]>;
}

/**
 * TenantRepository class that encapsulates the event context
 * This allows for cleaner function signatures without breaking changes
 */
export class TenantRepository implements IRepository {
  private event: APIGatewayProxyEvent;
  private _userId: string | null = null;

  constructor(event: APIGatewayProxyEvent) {
    this.event = event;
  }

  /**
   * Get the current user ID from the event
   * Caches the value for performance
   */
  get userId(): string {
    if (!this._userId) {
      this._userId = this.event.requestContext.authorizer?.claims?.['cognito:username'] || 
                     this.event.requestContext.authorizer?.principalId ||
                     'unknown';
    }
    return this._userId;
  }

  /**
   * Get tenant ID from the event
   */
  get tenantId(): string {
    return this.event.requestContext.authorizer?.claims?.['custom:tenant_id'] || 'default';
  }

  // Chat operations
  async createChat(userId: string): Promise<Chat> {
    return repository.createChat(userId, this.event);
  }

  async findChatById(userId: string, chatId: string): Promise<Chat | null> {
    return repository.findChatById(userId, chatId, this.event);
  }

  async listChats(
    userId: string,
    exclusiveStartKey?: string
  ): Promise<ListChatsResponse> {
    return repository.listChats(userId, this.event, exclusiveStartKey);
  }

  async setChatTitle(
    id: string,
    createdDate: string,
    title: string
  ): Promise<Chat> {
    return repository.setChatTitle(id, createdDate, title, this.event);
  }

  async deleteChat(userId: string, chatId: string): Promise<void> {
    return repository.deleteChat(userId, chatId, this.event);
  }

  // System context operations
  async findSystemContextById(
    userId: string,
    systemContextId: string
  ): Promise<SystemContext | null> {
    return repository.findSystemContextById(userId, systemContextId, this.event);
  }

  async listSystemContexts(userId: string): Promise<SystemContext[]> {
    return repository.listSystemContexts(userId, this.event);
  }

  async createSystemContext(
    userId: string,
    title: string,
    systemContext: string
  ): Promise<SystemContext> {
    return repository.createSystemContext(userId, title, systemContext, this.event);
  }

  async updateSystemContextTitle(
    userId: string,
    systemContextId: string,
    title: string
  ): Promise<SystemContext> {
    return repository.updateSystemContextTitle(
      userId,
      systemContextId,
      title,
      this.event
    );
  }

  async deleteSystemContext(
    userId: string,
    systemContextId: string
  ): Promise<void> {
    return repository.deleteSystemContext(userId, systemContextId, this.event);
  }

  // Message operations
  async listMessages(chatId: string): Promise<RecordedMessage[]> {
    return repository.listMessages(chatId, this.event);
  }

  async batchCreateMessages(
    messages: ToBeRecordedMessage[],
    userId: string,
    chatId: string
  ): Promise<RecordedMessage[]> {
    return repository.batchCreateMessages(messages, userId, chatId, this.event);
  }

  async updateFeedback(
    chatId: string,
    feedbackData: UpdateFeedbackRequest
  ): Promise<RecordedMessage> {
    return repository.updateFeedback(chatId, feedbackData, this.event);
  }

  // Share operations
  async createShareId(
    userId: string,
    chatId: string
  ): Promise<{
    shareId: ShareId;
    userIdAndChatId: UserIdAndChatId;
  }> {
    return repository.createShareId(userId, chatId, this.event);
  }

  async findUserIdAndChatId(shareId: string): Promise<UserIdAndChatId | null> {
    return repository.findUserIdAndChatId(shareId, this.event);
  }

  async findShareId(userId: string, chatId: string): Promise<ShareId | null> {
    return repository.findShareId(userId, chatId, this.event);
  }

  async deleteShareId(shareId: string): Promise<void> {
    return repository.deleteShareId(shareId, this.event);
  }

  // Token usage operations
  async aggregateTokenUsage(
    startDate: string,
    endDate: string,
    userIds?: string[]
  ): Promise<TokenUsageStats[]> {
    return repository.aggregateTokenUsage(startDate, endDate, this.event, userIds);
  }
}

/**
 * Factory function to create a tenant-aware repository
 */
export function createTenantRepository(event: APIGatewayProxyEvent): TenantRepository {
  return new TenantRepository(event);
}

/**
 * Simplified handler wrapper that provides repository and user context
 */
export type TenantHandler = (
  repo: TenantRepository,
  userId: string,
  event: APIGatewayProxyEvent
) => Promise<APIGatewayProxyResult>;

/**
 * Higher-order function to wrap Lambda handlers with tenant repository
 * Automatically extracts userId and creates repository instance
 */
export function withTenantRepository(
  handler: TenantHandler
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const repo = createTenantRepository(event);
      const userId = repo.userId;
      
      return await handler(repo, userId, event);
    } catch (error) {
      console.error('Handler error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Internal server error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      };
    }
  };
}

/**
 * Even simpler handler for operations that only need repository
 */
export type SimpleHandler = (
  repo: TenantRepository
) => Promise<APIGatewayProxyResult>;

/**
 * Minimal wrapper for simple operations
 */
export function withRepository(
  handler: SimpleHandler
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const repo = createTenantRepository(event);
      return await handler(repo);
    } catch (error) {
      console.error('Handler error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Internal server error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      };
    }
  };
}

/**
 * Example usage patterns:
 * 
 * 1. SIMPLEST - Using withRepository wrapper (recommended for new code):
 * ```typescript
 * export const handler = withRepository(async (repo) => {
 *   const chat = await repo.createChat(repo.userId);
 *   const messages = await repo.listMessages(chat.id);
 *   
 *   return {
 *     statusCode: 200,
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ chat, messages })
 *   };
 * });
 * ```
 * 
 * 2. Using withTenantRepository wrapper (when you need userId separately):
 * ```typescript
 * export const handler = withTenantRepository(async (repo, userId, event) => {
 *   const chatId = event.pathParameters!.chatId!;
 *   
 *   // Authorization check
 *   const chat = await repo.findChatById(userId, chatId);
 *   if (!chat) {
 *     return {
 *       statusCode: 403,
 *       body: JSON.stringify({ message: 'Forbidden' })
 *     };
 *   }
 *   
 *   const messages = await repo.listMessages(chatId);
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify({ messages })
 *   };
 * });
 * ```
 * 
 * 3. Manual repository creation (for complex scenarios):
 * ```typescript
 * export const handler = async (event: APIGatewayProxyEvent) => {
 *   const repo = createTenantRepository(event);
 *   const userId = repo.userId;
 *   
 *   // Complex business logic here
 *   const chat = await repo.createChat(userId);
 *   const messages = await repo.listMessages(chat.id);
 *   
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify({ chat, messages })
 *   };
 * }
 * ```
 * 
 * 4. Gradual migration from old code:
 * ```typescript
 * export const handler = async (event: APIGatewayProxyEvent) => {
 *   const userId = event.requestContext.authorizer!.claims['cognito:username'];
 *   
 *   // Old code - still works
 *   const oldChat = await createChat(userId, event);
 *   
 *   // New code - cleaner
 *   const repo = createTenantRepository(event);
 *   const newChat = await repo.createChat(userId);
 *   
 *   return { statusCode: 200, body: JSON.stringify({ oldChat, newChat }) };
 * }
 * ```
 */