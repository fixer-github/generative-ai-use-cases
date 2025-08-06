/**
 * Examples of simplified Lambda handlers using the improved repository pattern
 * These examples show how much cleaner the code becomes with the new pattern
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  withRepository, 
  withTenantRepository, 
  createTenantRepository 
} from '../tenantRepository';

// ============================================
// BEFORE: Old pattern with event passing
// ============================================

import { createChat, listMessages, findChatById } from '../repository';

export const oldCreateChatHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer!.claims['cognito:username'];
    const chat = await createChat(userId, event); // Need to pass event
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ chat }),
    };
  } catch (error) {
    console.error('Error creating chat:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Failed to create chat',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

// ============================================
// AFTER: New pattern - Option 1 (Simplest)
// ============================================

export const newCreateChatHandler = withRepository(async (repo) => {
  // No need to extract userId or pass event!
  const chat = await repo.createChat(repo.userId);
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ chat }),
  };
});

// ============================================
// AFTER: New pattern - Option 2 (With context)
// ============================================

export const listMessagesHandler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  
  // Authorization check
  const chat = await repo.findChatById(userId, chatId);
  if (!chat) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Chat not found or access denied' }),
    };
  }
  
  const messages = await repo.listMessages(chatId);
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ messages }),
  };
});

// ============================================
// Complex Example: Multi-step operation
// ============================================

export const complexOperationHandler = withRepository(async (repo) => {
  // Create a new chat
  const chat = await repo.createChat(repo.userId);
  
  // Create initial messages
  const messages = await repo.batchCreateMessages(
    [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello!' },
    ],
    repo.userId,
    chat.id
  );
  
  // Set chat title
  await repo.setChatTitle(chat.id, chat.createdDate, 'New Conversation');
  
  // Create a share link
  const { shareId } = await repo.createShareId(repo.userId, chat.id);
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ 
      chat, 
      messages, 
      shareUrl: `/shared/${shareId.shareId.split('#')[1]}` 
    }),
  };
});

// ============================================
// Migration Example: Gradual adoption
// ============================================

export const migrationExampleHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer!.claims['cognito:username'];
    
    // Old code - still works but verbose
    const oldStyleChat = await createChat(userId, event);
    const oldStyleMessages = await listMessages(oldStyleChat.id, event);
    
    // New code - much cleaner
    const repo = createTenantRepository(event);
    const newStyleChat = await repo.createChat(userId);
    const newStyleMessages = await repo.listMessages(newStyleChat.id);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        old: { chat: oldStyleChat, messages: oldStyleMessages },
        new: { chat: newStyleChat, messages: newStyleMessages },
      }),
    };
  } catch (error) {
    console.error('Error:', error);
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

// ============================================
// Benefits Summary:
// ============================================
/**
 * 1. **Less Boilerplate**: No need for try-catch blocks in every handler
 * 2. **Automatic Error Handling**: Errors are caught and formatted consistently
 * 3. **No Event Passing**: Repository methods don't need the event parameter
 * 4. **Type Safety**: Full TypeScript support with interfaces
 * 5. **Cleaner Code**: Focus on business logic, not infrastructure
 * 6. **Easy Testing**: Repository can be mocked easily
 * 7. **Gradual Migration**: Old and new patterns work side by side
 * 
 * Code reduction example:
 * - Old pattern: ~30 lines for simple handler
 * - New pattern: ~10 lines for same functionality
 * - 66% less code to write and maintain!
 */