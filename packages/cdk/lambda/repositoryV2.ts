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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId, getTenantTableName } from './utils/tenantUtils';

const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

/**
 * Repository class that handles tenant-specific table access
 */
export class TenantRepository {
  private tenantId: string;
  private tablePrefix: string;
  private statsTablePrefix: string;

  constructor(event: APIGatewayProxyEvent) {
    this.tenantId = getTenantId(event);
    // Extract base table name without tenant suffix
    this.tablePrefix = process.env.TABLE_NAME!.replace(/-tenant-.*$/, '');
    this.statsTablePrefix = process.env.STATS_TABLE_NAME!.replace(/-tenant-.*$/, '');
  }

  private getTableName(): string {
    return getTenantTableName(this.tablePrefix, this.tenantId);
  }

  private getStatsTableName(): string {
    return getTenantTableName(this.statsTablePrefix, this.tenantId);
  }

  async createChat(_userId: string): Promise<Chat> {
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
        TableName: this.getTableName(),
        Item: item,
      })
    );

    return item;
  }

  async findChatById(
    _userId: string,
    _chatId: string
  ): Promise<Chat | null> {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    const res = await dynamoDbDocument.send(
      new QueryCommand({
        TableName: this.getTableName(),
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
    return chat as Chat;
  }

  async listChats(_userId: string): Promise<ListChatsResponse> {
    const userId = `user#${_userId}`;
    const res = await dynamoDbDocument.send(
      new QueryCommand({
        TableName: this.getTableName(),
        KeyConditionExpression: '#id = :id',
        ExpressionAttributeNames: {
          '#id': 'id',
        },
        ExpressionAttributeValues: {
          ':id': userId,
        },
        ScanIndexForward: false,
      })
    );

    const chats: Chat[] = res.Items
      ? (res.Items.filter((item) => {
          return item.chatId.startsWith('chat#');
        }) as Chat[])
      : [];
    const systemContexts: SystemContext[] = res.Items
      ? res.Items.filter((item) => {
          return item.chatId.startsWith('systemContext#');
        }).map((item) => {
          return {
            systemContextId: item.chatId,
            systemContext: item.systemContext,
            systemContextTitle: item.systemContextTitle,
          };
        })
      : [];

    return {
      chats,
      systemContexts,
    };
  }

  async createMessages(
    _userId: string,
    _chatId: string,
    messages: ToBeRecordedMessage[]
  ) {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    const items = messages.map((message) => {
      const createdDate = Date.now();
      const messageId = `${createdDate}-${crypto.randomUUID()}`;
      const item = {
        id: userId,
        createdDate: `${createdDate}`,
        messageId,
        role: message.role,
        model: message.model,
        content: message.content,
        chatId,
        userId,
        feedback: '',
        system: message.system,
        usedChunks: message.usedChunks,
        // Omit token count because in streaming, token count is not returned
        inputTokenCount: message.inputTokenCount ?? 0,
        outputTokenCount: message.outputTokenCount ?? 0,
        totalTokenCount: message.totalTokenCount ?? 0,
      };
      return item;
    });

    // Add token usage stats
    await this.updateTokenUsage(items);

    // Atomic Conditional Check and Write
    const existCheckRes = await dynamoDbDocument.send(
      new QueryCommand({
        TableName: this.getTableName(),
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

    if (existCheckRes.Items && existCheckRes.Items.length > 0) {
      await dynamoDbDocument.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.getTableName()]: items.map((m) => {
              return {
                PutRequest: {
                  Item: m,
                },
              };
            }),
          },
        })
      );
    } else {
      throw new Error('Chat not found');
    }
  }

  async findMessagesByChatId(
    _userId: string,
    _chatId: string
  ): Promise<RecordedMessage[]> {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    const res = await dynamoDbDocument.send(
      new QueryCommand({
        TableName: this.getTableName(),
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

    const messages: RecordedMessage[] = res.Items
      ? (res.Items.filter((item) => {
          return item.role && item.model;
        }) as RecordedMessage[])
      : [];
    return messages;
  }

  async updateFeedback(
    _userId: string,
    _messageId: string,
    feedback: UpdateFeedbackRequest
  ): Promise<void> {
    const userId = `user#${_userId}`;
    
    const res = await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: {
          id: userId,
          createdDate: _messageId.split('-')[0],
        },
        UpdateExpression: 'set feedback = :feedback',
        ExpressionAttributeValues: {
          ':feedback': feedback.feedback,
        },
        ConditionExpression: 'begins_with(messageId, :messageId)',
        ExpressionAttributeValues: {
          ':feedback': feedback.feedback,
          ':messageId': _messageId,
        },
      })
    );
    
    return;
  }

  async updateTitle(
    _userId: string,
    _chatId: string,
    title: string
  ): Promise<void> {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    
    const res = await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: {
          id: userId,
          createdDate: chatId.split('#')[1],
        },
        UpdateExpression: 'set title = :title',
        ExpressionAttributeValues: {
          ':title': title,
        },
      })
    );
    
    return;
  }

  async deleteChat(_userId: string, _chatId: string): Promise<void> {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    
    const chatItem = await this.findChatById(_userId, _chatId);
    const messageItems = await this.findMessagesByChatId(_userId, _chatId);

    await dynamoDbDocument.send(
      new DeleteCommand({
        TableName: this.getTableName(),
        Key: {
          id: chatItem?.id,
          createdDate: chatItem?.createdDate,
        },
      })
    );

    await dynamoDbDocument.send(
      new BatchWriteCommand({
        RequestItems: {
          [this.getTableName()]: messageItems.map((m) => {
            return {
              DeleteRequest: {
                Key: {
                  id: m.id,
                  createdDate: m.createdDate,
                },
              },
            };
          }),
        },
      })
    );
  }

  // Token usage stats methods
  private async updateTokenUsage(items: any[]): Promise<void> {
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

    // Update stats table for each model
    for (const [model, usage] of Object.entries(modelUsageUpdates)) {
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: this.getStatsTableName(),
          Key: {
            id: `stats#${dateStr}`,
            model: model,
          },
          UpdateExpression: 
            'SET #date = :date, #month = :month ' +
            'ADD inputTokens :inputTokens, outputTokens :outputTokens, totalTokens :totalTokens',
          ExpressionAttributeNames: {
            '#date': 'date',
            '#month': 'month',
          },
          ExpressionAttributeValues: {
            ':date': dateStr,
            ':month': dateStr.substring(0, 7),
            ':inputTokens': usage.input,
            ':outputTokens': usage.output,
            ':totalTokens': usage.input + usage.output,
          },
        })
      );
    }
  }

  // Add other methods as needed...
}

/**
 * Factory function to create a repository instance
 */
export const createTenantRepository = (event: APIGatewayProxyEvent): TenantRepository => {
  return new TenantRepository(event);
};