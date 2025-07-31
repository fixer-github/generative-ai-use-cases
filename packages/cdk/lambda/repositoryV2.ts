import {
  Chat,
  RecordedMessage,
  ToBeRecordedMessage,
  UpdateFeedbackRequest,
  ListChatsResponse,
} from 'generative-ai-use-cases';
import * as crypto from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getTenantId, getTenantTableName } from './utils/tenantUtils';

const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

// Interface for message items stored in DynamoDB
interface MessageItem {
  id: string;
  createdDate: string;
  messageId: string;
  role: string;
  model: string;
  content: string;
  chatId: string;
  userId: string;
  feedback: string;
  system?: string;
  usedChunks?: string[];
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
}

/**
 * Repository class that handles tenant-specific table access
 */
export class TenantRepository {
  constructor(event) {
    this.tenantId = getTenantId(event);
    // Extract base table name without tenant suffix
    this.tablePrefix = process.env.TABLE_NAME.replace(/-tenant-.*$/, '');
    this.statsTablePrefix = process.env.STATS_TABLE_NAME.replace(/-tenant-.*$/, '');
  }

  getTableName() {
    return getTenantTableName(this.tablePrefix, this.tenantId);
  }

  getStatsTableName() {
    return getTenantTableName(this.statsTablePrefix, this.tenantId);
  }

  async createChat(_userId) {
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

  async findChatById(_userId, _chatId) {
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
    return chat;
  }

  async listChats(_userId) {
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

    const chats = res.Items
      ? res.Items.filter((item) => {
          return item.chatId.startsWith('chat#');
        })
      : [];
    // Return in the format of ListChatsResponse (Pagination<Chat>)
    return {
      data: chats,
      lastEvaluatedKey: res.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
        : undefined,
    };
  }

  async createMessages(_userId, _chatId, messages) {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    const items: MessageItem[] = messages.map((message) => {
      const createdDate = Date.now();
      const messageId = message.messageId || `${createdDate}-${crypto.randomUUID()}`;
      const item: MessageItem = {
        id: userId,
        createdDate: String(createdDate),
        role: message.role,
        content: message.content,
        model: message.model,
        chatId: chatId,
        userId: _userId,
        feedback: '',
        usecase: message.usecase,
        messageId,
        inputTokenCount: message.inputTokenCount,
        outputTokenCount: message.outputTokenCount,
        totalTokenCount: message.totalTokenCount,
        stopReason: message.stopReason,
      };
      if (message.systemContext) {
        item.systemContext = message.systemContext;
      }
      if (message.messageId) {
        item.parent = message.messageId;
      }
      return item;
    });

    if (items.length > 0) {
      await dynamoDbDocument.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.getTableName()]: items.map((item) => ({
              PutRequest: {
                Item: item,
              },
            })),
          },
        })
      );

      // Update token usage stats
      await this.updateTokenUsage(items);

      // Update chat updated time
      const chatItem = await this.findChatById(_userId, _chatId);
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: this.getTableName(),
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
    } else {
      throw new Error('Chat not found');
    }
  }

  async findMessagesByChatId(_userId, _chatId) {
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

    const messages = res.Items
      ? res.Items.filter((item) => {
          return item.role && item.model;
        })
      : [];
    return messages;
  }

  async updateFeedback(_userId, _messageId, feedback) {
    const userId = `user#${_userId}`;
    
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: {
          id: userId,
          createdDate: _messageId.split('-')[0],
        },
        UpdateExpression: 'SET #feedback = :feedback',
        ExpressionAttributeNames: {
          '#feedback': 'feedback',
        },
        ExpressionAttributeValues: {
          ':feedback': feedback,
        },
      })
    );
  }

  async updateTitle(_userId, _chatId, title) {
    const userId = `user#${_userId}`;
    const chatId = `chat#${_chatId}`;
    
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: this.getTableName(),
        Key: {
          id: userId,
          createdDate: (await this.findChatById(_userId, _chatId)).createdDate,
        },
        UpdateExpression: 'SET #title = :title',
        ExpressionAttributeNames: {
          '#title': 'title',
        },
        ExpressionAttributeValues: {
          ':title': title,
        },
      })
    );
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
          id: userId,
          createdDate: chatItem.createdDate,
        },
      })
    );

    if (messageItems.length > 0) {
      await dynamoDbDocument.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.getTableName()]: messageItems.map((item) => {
              return {
                DeleteRequest: {
                  Key: {
                    id: userId,
                    createdDate: item.createdDate,
                  },
                },
              };
            }),
          },
        })
      );
    }
  }

  // Token usage stats methods
  async updateTokenUsage(items) {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const modelUsageUpdates = {};

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
      await this.updateModelUsage(dateStr, model, usage);
    }
  }

  async updateModelUsage(dateStr, model, usage) {
    const statsId = `stats#${dateStr}`;
    const modelKey = `model#${model}`;

    try {
      // Try to update existing record
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: this.getStatsTableName(),
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
    } catch (error) {
      // If record doesn't exist, create it
      if (error.name === 'ValidationException') {
        await dynamoDbDocument.send(
          new PutCommand({
            TableName: this.getStatsTableName(),
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

  async getTokenUsageStats(startDate, endDate) {
    const results = [];
    const currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const statsId = `stats#${dateStr}`;

      const res = await dynamoDbDocument.send(
        new QueryCommand({
          TableName: this.getStatsTableName(),
          KeyConditionExpression: '#id = :id',
          ExpressionAttributeNames: {
            '#id': 'id',
          },
          ExpressionAttributeValues: {
            ':id': statsId,
          },
        })
      );

      if (res.Items && res.Items.length > 0) {
        results.push(...res.Items);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return results;
  }

  // Share functionality
  async createShareId(_userId, chatId) {
    const userId = `user#${_userId}`;
    const res = await this.findMessagesByChatId(_userId, chatId);
    const shareId = crypto.randomUUID();

    const items = [
      // Share metadata
      {
        id: `share#${shareId}`,
        chatId,
        userId,
        createdDate: String(Date.now()),
        messages: JSON.stringify(res),
      },
    ];

    await dynamoDbDocument.send(
      new BatchWriteCommand({
        RequestItems: {
          [this.getTableName()]: items.map((item) => ({
            PutRequest: {
              Item: item,
            },
          })),
        },
      })
    );

    return {
      shareId,
    };
  }

  async findShareById(shareId) {
    const res = await dynamoDbDocument.send(
      new QueryCommand({
        TableName: this.getTableName(),
        KeyConditionExpression: '#id = :id',
        ExpressionAttributeNames: {
          '#id': 'id',
        },
        ExpressionAttributeValues: {
          ':id': `share#${shareId}`,
        },
      })
    );

    const share = res.Items ? res.Items[0] : null;
    if (!share) {
      return null;
    }

    const userIdFromShareData = share.userId;
    const userPK = `user#${userIdFromShareData}`;
    
    const userRes = await dynamoDbDocument.send(
      new BatchGetCommand({
        RequestItems: {
          [this.getTableName()]: {
            Keys: [
              {
                id: userPK,
                createdDate: share.chatId.split('#')[1],
              },
            ],
          },
        },
      })
    );

    const chat = userRes.Responses[this.getTableName()][0];
    return {
      shareId: share.id,
      chatId: share.chatId,
      userId: share.userId,
      createdDate: share.createdDate,
      messages: JSON.parse(share.messages),
      title: chat?.title || '',
    };
  }

  // System context
  async findSystemContextById(_userId, systemContextId) {
    const userId = `user#${_userId}`;
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
          ':chatId': systemContextId,
        },
      })
    );

    const systemContext = res.Items ? res.Items[0] : null;
    if (!systemContext) {
      return null;
    }
    return systemContext;
  }

  async createSystemContext(_userId, systemContext) {
    const userId = `user#${_userId}`;
    const systemContextId = `systemContext#${crypto.randomUUID()}`;
    const item = {
      id: userId,
      createdDate: `${Date.now()}`,
      chatId: systemContextId,
      systemContext: systemContext.systemContext,
      systemContextTitle: systemContext.systemContextTitle,
    };

    await dynamoDbDocument.send(
      new PutCommand({
        TableName: this.getTableName(),
        Item: item,
      })
    );

    return {
      systemContext: item.systemContext,
      systemContextId: item.chatId,
      systemContextTitle: item.systemContextTitle,
    };
  }

  async deleteSystemContext(_userId, systemContextId) {
    const userId = `user#${_userId}`;
    const systemContext = await this.findSystemContextById(
      _userId,
      systemContextId
    );
    if (!systemContext) {
      throw new Error('System context not found');
    }
    await dynamoDbDocument.send(
      new DeleteCommand({
        TableName: this.getTableName(),
        Key: {
          id: userId,
          createdDate: systemContext.createdDate,
        },
      })
    );
  }
}