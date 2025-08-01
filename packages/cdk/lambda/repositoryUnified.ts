import {
  Chat,
  RecordedMessage,
  ToBeRecordedMessage,
  ShareId,
  UserIdAndChatId,
  SystemContext,
  UpdateFeedbackRequest,
  ListChatsResponse,
  TokenUsageStats,
} from 'generative-ai-use-cases';
import * as crypto from 'crypto';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId, getTenantTableName } from './utils/tenantUtils';
import { createTenantDynamoDBClient } from './utils/unifiedTenantClient';

// Cache DynamoDB clients per tenant
const clientCache = new Map<string, DynamoDBDocumentClient>();

/**
 * Get or create a tenant-specific DynamoDB document client
 */
async function getTenantDynamoDBDocument(
  event: APIGatewayProxyEvent
): Promise<DynamoDBDocumentClient> {
  const tenantId = getTenantId(event);
  
  // Check if we already have a client for this tenant
  let client = clientCache.get(tenantId);
  if (client) {
    return client;
  }

  // Create new client with tenant credentials
  const dynamoDb = await createTenantDynamoDBClient(event);
  client = DynamoDBDocumentClient.from(dynamoDb);
  
  // Cache for future use
  clientCache.set(tenantId, client);
  
  return client;
}

/**
 * Get tenant-specific table name
 */
function getTableName(baseTableName: string, event: APIGatewayProxyEvent): string {
  const tenantId = getTenantId(event);
  return getTenantTableName(baseTableName, tenantId);
}

// ============================================
// Unified Repository Functions
// All functions now use IAM-secured clients
// ============================================

export const createChat = async (
  _userId: string,
  event: APIGatewayProxyEvent
): Promise<Chat> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const chatId = `chat#${crypto.randomUUID()}`;
  const item = {
    id: userId,
    createdDate: `${Date.now()}`,
    chatId,
    usecase: '',
    title: '',
    updatedDate: '',
  };

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return {
    id: chatId.split('#')[1],
    createdDate: item.createdDate,
    usecase: '',
    title: '',
    updatedDate: '',
  };
};

export const findChatById = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<Chat | null> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#chatId = :chatId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#chatId': 'chatId',
      },
      ExpressionAttributeValues: {
        ':id': userId,
        ':chatId': chatId,
      },
    })
  );

  const chat = res.Items ? res.Items[0] : null;
  if (!chat) {
    return null;
  }
  
  return {
    id: chat.chatId.split('#')[1],
    createdDate: chat.createdDate,
    title: chat.title,
    updatedDate: chat.updatedDate,
  };
};

export const listChats = async (
  _userId: string,
  event: APIGatewayProxyEvent,
  lastEvaluatedKey?: string
): Promise<ListChatsResponse> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const params: any = {
    TableName: tableName,
    KeyConditionExpression: '#id = :id',
    ExpressionAttributeNames: {
      '#id': 'id',
    },
    ExpressionAttributeValues: {
      ':id': userId,
    },
    ScanIndexForward: false,
  };

  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = JSON.parse(
      Buffer.from(lastEvaluatedKey, 'base64').toString()
    );
  }

  const res = await dynamoDbDocument.send(new QueryCommand(params));

  const chats = res.Items
    ? res.Items.filter((item) => item.chatId.startsWith('chat#')).map(
        (chat) => ({
          id: chat.chatId.split('#')[1],
          createdDate: chat.createdDate,
          title: chat.title,
          updatedDate: chat.updatedDate,
        })
      )
    : [];

  return {
    data: chats,
    lastEvaluatedKey: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
};

export const batchCreateMessages = async (
  messages: ToBeRecordedMessage[],
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<RecordedMessage[]> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  const statsTableName = getTableName(process.env.STATS_TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const items: any[] = [];
  const returnItems: RecordedMessage[] = [];

  messages.forEach((message) => {
    const { id, ...messageWithoutId } = message;
    const createdDate = Date.now();
    const messageId = id || `${createdDate}-${crypto.randomUUID()}`;
    const item = {
      id: userId,
      role: message.role,
      createdDate: String(createdDate),
      content: messageWithoutId.content,
      model: messageWithoutId.model,
      chatId: chatId,
      userId: _userId,
      messageId,
      feedback: '',
      usecase: message.usecase,
      // Token counting
      inputTokenCount: message.inputTokenCount || 0,
      outputTokenCount: message.outputTokenCount || 0,
      totalTokenCount: message.totalTokenCount || 0,
      stopReason: message.stopReason,
    };
    
    if (message.system) item.system = message.system;
    if (message.messageId) item.parent = message.messageId;
    if (message.usedChunks) item.usedChunks = message.usedChunks;
    if (message.thinkingLog) item.thinkingLog = message.thinkingLog;
    
    items.push(item);
    returnItems.push({ ...item, id: messageId });
  });

  await dynamoDbDocument.send(
    new BatchWriteCommand({
      RequestItems: {
        [tableName]: items.map((item) => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    })
  );

  // Update chat timestamp
  const chatItem = await findChatById(_userId, _chatId, event);
  if (chatItem) {
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          id: userId,
          createdDate: chatItem.createdDate,
        },
        UpdateExpression: 'SET #updatedDate = :updatedDate',
        ExpressionAttributeNames: {
          '#updatedDate': 'updatedDate',
        },
        ExpressionAttributeValues: {
          ':updatedDate': String(Date.now()),
        },
      })
    );
  }

  // Update token usage statistics
  await updateTokenUsage(items, event, dynamoDbDocument, statsTableName);

  return returnItems;
};

// Helper function to update token usage
async function updateTokenUsage(
  items: any[],
  event: APIGatewayProxyEvent,
  dynamoDbDocument: DynamoDBDocumentClient,
  statsTableName: string
): Promise<void> {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const modelUsageUpdates: { [model: string]: { input: number; output: number } } = {};

  // Aggregate token counts by model
  items.forEach((item) => {
    if (item.role === 'assistant' && item.model) {
      if (!modelUsageUpdates[item.model]) {
        modelUsageUpdates[item.model] = { input: 0, output: 0 };
      }
      modelUsageUpdates[item.model].input += item.inputTokenCount || 0;
      modelUsageUpdates[item.model].output += item.outputTokenCount || 0;
    }
  });

  // Update stats for each model
  for (const [model, usage] of Object.entries(modelUsageUpdates)) {
    const statsId = `stats#${dateStr}`;
    const modelKey = `model#${model}`;

    try {
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: statsTableName,
          Key: {
            id: statsId,
            sortKey: modelKey,
          },
          UpdateExpression: 'ADD #inputTokens :inputTokens, #outputTokens :outputTokens',
          ExpressionAttributeNames: {
            '#inputTokens': 'inputTokens',
            '#outputTokens': 'outputTokens',
          },
          ExpressionAttributeValues: {
            ':inputTokens': usage.input,
            ':outputTokens': usage.output,
          },
        })
      );
    } catch (error: any) {
      // If record doesn't exist, create it
      if (error.name === 'ValidationException') {
        await dynamoDbDocument.send(
          new PutCommand({
            TableName: statsTableName,
            Item: {
              id: statsId,
              sortKey: modelKey,
              date: dateStr,
              model: model,
              inputTokens: usage.input,
              outputTokens: usage.output,
              totalTokens: usage.input + usage.output,
            },
          })
        );
      } else {
        throw error;
      }
    }
  }
}

// Export other functions following the same pattern...
// All functions will:
// 1. Get tenant-specific DynamoDB client using getTenantDynamoDBDocument()
// 2. Use tenant-specific table names
// 3. IAM automatically enforces access to correct tenant resources

export const deleteChat = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<void> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  
  // Get chat and messages
  const chatItem = await findChatById(_userId, _chatId, event);
  if (!chatItem) {
    throw new Error('Chat not found');
  }

  const messageItems = await listMessages(_userId, _chatId, event);

  // Delete chat
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        id: userId,
        createdDate: chatItem.createdDate,
      },
    })
  );

  // Delete messages
  if (messageItems.length > 0) {
    await dynamoDbDocument.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: messageItems.map((item) => ({
            DeleteRequest: {
              Key: {
                id: userId,
                createdDate: item.createdDate,
              },
            },
          })),
        },
      })
    );
  }
};

export const listMessages = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<RecordedMessage[]> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(process.env.TABLE_NAME!, event);
  
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#chatId = :chatId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#chatId': 'chatId',
      },
      ExpressionAttributeValues: {
        ':id': userId,
        ':chatId': chatId,
      },
    })
  );

  const messages = res.Items
    ? res.Items.filter((item) => item.role && item.model).map((item) => ({
        id: item.messageId,
        createdDate: item.createdDate,
        chatId: item.chatId.split('#')[1],
        userId: item.userId,
        role: item.role,
        content: item.content,
        model: item.model,
        feedback: item.feedback,
        inputTokenCount: item.inputTokenCount || 0,
        outputTokenCount: item.outputTokenCount || 0,
        totalTokenCount: item.totalTokenCount || 0,
        parent: item.parent,
        usedChunks: item.usedChunks,
        thinkingLog: item.thinkingLog,
      }))
    : [];

  return messages;
};