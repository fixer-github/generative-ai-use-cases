/**
 * Tenant-aware repository wrapper
 * This provides a cleaner API that doesn't require passing the event to every function
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
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
 * TenantRepository class that encapsulates the event context
 * This allows for cleaner function signatures without breaking changes
 */
export class TenantRepository {
  private event: APIGatewayProxyEvent;

  constructor(event: APIGatewayProxyEvent) {
    this.event = event;
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
 * Higher-order function to wrap Lambda handlers with tenant context
 * This allows existing code to work without modification
 */
export function withTenantContext<T extends (...args: any[]) => Promise<any>>(
  handler: T
): (event: APIGatewayProxyEvent, ...args: Parameters<T>) => ReturnType<T> {
  return (event: APIGatewayProxyEvent, ...args: Parameters<T>) => {
    // Store event in a context that repository functions can access
    // This would require a more complex implementation with AsyncLocalStorage
    // For now, the TenantRepository class approach is cleaner
    return handler(...args);
  };
}

/**
 * Example usage patterns:
 * 
 * 1. Using TenantRepository class (recommended):
 * ```typescript
 * export const handler = async (event: APIGatewayProxyEvent) => {
 *   const repo = createTenantRepository(event);
 *   const userId = event.requestContext.authorizer!.claims['cognito:username'];
 *   
 *   const chat = await repo.createChat(userId);
 *   const messages = await repo.listMessages(chat.id);
 *   // ... etc
 * }
 * ```
 * 
 * 2. Direct usage with event (current approach):
 * ```typescript
 * export const handler = async (event: APIGatewayProxyEvent) => {
 *   const userId = event.requestContext.authorizer!.claims['cognito:username'];
 *   
 *   const chat = await createChat(userId, event);
 *   const messages = await listMessages(chat.id, event);
 *   // ... etc
 * }
 * ```
 * 
 * 3. Migration path - gradual adoption:
 * ```typescript
 * // Old code continues to work
 * const chat = await createChat(userId, event);
 * 
 * // New code uses wrapper
 * const repo = createTenantRepository(event);
 * const chat = await repo.createChat(userId);
 * ```
 */