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
import { getTableNameForTenant } from './utils/tenantUtils';

const TABLE_NAME: string = process.env.TABLE_NAME!;
const STATS_TABLE_NAME: string = process.env.STATS_TABLE_NAME!;
const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

export const createChat = async (_userId: string, event: APIGatewayProxyEvent): Promise<Chat> => {
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

  const tableName = getTableNameForTenant('TABLE_NAME', event);

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

export const findChatById = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<Chat | null> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
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

  if (!res.Items || res.Items.length === 0) {
    return null;
  } else {
    return res.Items[0] as Chat;
  }
};

export const findSystemContextById = async (
  _userId: string,
  _systemContextId: string,
  event: APIGatewayProxyEvent
): Promise<SystemContext | null> => {
  const userId = `systemContext#${_userId}`;
  const systemContextId = `systemContext#${_systemContextId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#systemContextId = :systemContextId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#systemContextId': 'systemContextId',
      },
      ExpressionAttributeValues: {
        ':id': userId,
        ':systemContextId': systemContextId,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  } else {
    return res.Items[0] as SystemContext;
  }
};

export const listChats = async (
  _userId: string,
  event: APIGatewayProxyEvent,
  _exclusiveStartKey?: string
): Promise<ListChatsResponse> => {
  const exclusiveStartKey = _exclusiveStartKey
    ? JSON.parse(Buffer.from(_exclusiveStartKey, 'base64').toString())
    : undefined;
  const userId = `user#${_userId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': userId,
      },
      ScanIndexForward: false,
      Limit: 100, // Return the list of chats in 100 items at a time
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  return {
    data: res.Items as Chat[],
    lastEvaluatedKey: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
};

export const listSystemContexts = async (
  _userId: string,
  event: APIGatewayProxyEvent
): Promise<SystemContext[]> => {
  const userId = `systemContext#${_userId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
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
  return res.Items as SystemContext[];
};

export const createSystemContext = async (
  _userId: string,
  title: string,
  systemContext: string,
  event: APIGatewayProxyEvent
): Promise<SystemContext> => {
  const userId = `systemContext#${_userId}`;
  const systemContextId = `systemContext#${crypto.randomUUID()}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const item = {
    id: userId,
    createdDate: `${Date.now()}`,
    systemContextId: systemContextId,
    systemContext: systemContext,
    systemContextTitle: title,
  };

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

export const listMessages = async (
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<RecordedMessage[]> => {
  const chatId = `chat#${_chatId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': chatId,
      },
    })
  );

  return res.Items as RecordedMessage[];
};

// Update token usage
async function updateTokenUsage(message: RecordedMessage, event: APIGatewayProxyEvent): Promise<void> {
  if (!message.metadata?.usage) {
    return;
  }

  const timestamp = message.createdDate.split('#')[0];
  const date = new Date(parseInt(timestamp));
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const userId = message.userId.replace('user#', '');
  const modelId = message.llmType || 'unknown';
  const usecase = message.usecase || 'unknown';
  const usage = message.metadata?.usage || {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
  const statsTableName = getTableNameForTenant('STATS_TABLE_NAME', event);

  try {
    // Try to update with shallow nesting structure
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: statsTableName,
        Key: {
          id: `stats#${dateStr}`,
          userId: userId,
        },
        UpdateExpression: `
          SET
            #date = :date,
            executions.#overall = if_not_exists(executions.#overall, :zero) + :one,
            executions.#modelKey = if_not_exists(executions.#modelKey, :zero) + :one,
            executions.#usecaseKey = if_not_exists(executions.#usecaseKey, :zero) + :one,
            inputTokens.#overall = if_not_exists(inputTokens.#overall, :zero) + :inputTokens,
            inputTokens.#modelKey = if_not_exists(inputTokens.#modelKey, :zero) + :inputTokens,
            inputTokens.#usecaseKey = if_not_exists(inputTokens.#usecaseKey, :zero) + :inputTokens,
            outputTokens.#overall = if_not_exists(outputTokens.#overall, :zero) + :outputTokens,
            outputTokens.#modelKey = if_not_exists(outputTokens.#modelKey, :zero) + :outputTokens,
            outputTokens.#usecaseKey = if_not_exists(outputTokens.#usecaseKey, :zero) + :outputTokens,
            cacheReadInputTokens.#overall = if_not_exists(cacheReadInputTokens.#overall, :zero) + :cacheReadInputTokens,
            cacheReadInputTokens.#modelKey = if_not_exists(cacheReadInputTokens.#modelKey, :zero) + :cacheReadInputTokens,
            cacheReadInputTokens.#usecaseKey = if_not_exists(cacheReadInputTokens.#usecaseKey, :zero) + :cacheReadInputTokens,
            cacheWriteInputTokens.#overall = if_not_exists(cacheWriteInputTokens.#overall, :zero) + :cacheWriteInputTokens,
            cacheWriteInputTokens.#modelKey = if_not_exists(cacheWriteInputTokens.#modelKey, :zero) + :cacheWriteInputTokens,
            cacheWriteInputTokens.#usecaseKey = if_not_exists(cacheWriteInputTokens.#usecaseKey, :zero) + :cacheWriteInputTokens
        `,
        ExpressionAttributeNames: {
          '#date': 'date',
          '#overall': 'overall',
          '#modelKey': `model#${modelId}`,
          '#usecaseKey': `usecase#${usecase}`,
        },
        ExpressionAttributeValues: {
          ':date': dateStr,
          ':zero': 0,
          ':one': 1,
          ':inputTokens': usage.inputTokens || 0,
          ':outputTokens': usage.outputTokens || 0,
          ':cacheReadInputTokens': usage.cacheReadInputTokens || 0,
          ':cacheWriteInputTokens': usage.cacheWriteInputTokens || 0,
        },
      })
    );
  } catch (updateError) {
    console.log(
      'Record does not exist, creating initial structure:',
      updateError
    );
    try {
      // Create record with complete object structure (without condition)
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: statsTableName,
          Key: {
            id: `stats#${dateStr}`,
            userId: userId,
          },
          UpdateExpression: `
              SET
                #date = :date,
                executions = :executionsObj,
                inputTokens = :inputTokensObj,
                outputTokens = :outputTokensObj,
                cacheReadInputTokens = :cacheReadInputTokensObj,
                cacheWriteInputTokens = :cacheWriteInputTokensObj
            `,
          ExpressionAttributeNames: {
            '#date': 'date',
          },
          ExpressionAttributeValues: {
            ':date': dateStr,
            ':executionsObj': {
              overall: 1,
              [`model#${modelId}`]: 1,
              [`usecase#${usecase}`]: 1,
            },
            ':inputTokensObj': {
              overall: usage.inputTokens || 0,
              [`model#${modelId}`]: usage.inputTokens || 0,
              [`usecase#${usecase}`]: usage.inputTokens || 0,
            },
            ':outputTokensObj': {
              overall: usage.outputTokens || 0,
              [`model#${modelId}`]: usage.outputTokens || 0,
              [`usecase#${usecase}`]: usage.outputTokens || 0,
            },
            ':cacheReadInputTokensObj': {
              overall: usage.cacheReadInputTokens || 0,
              [`model#${modelId}`]: usage.cacheReadInputTokens || 0,
              [`usecase#${usecase}`]: usage.cacheReadInputTokens || 0,
            },
            ':cacheWriteInputTokensObj': {
              overall: usage.cacheWriteInputTokens || 0,
              [`model#${modelId}`]: usage.cacheWriteInputTokens || 0,
              [`usecase#${usecase}`]: usage.cacheWriteInputTokens || 0,
            },
          },
        })
      );
    } catch (putError) {
      console.error('Error creating token usage:', putError);
    }
  }
}

export const batchCreateMessages = async (
  messages: ToBeRecordedMessage[],
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<RecordedMessage[]> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const createdDate = Date.now();
  const feedback = 'none';
  const tableName = getTableNameForTenant('TABLE_NAME', event);

  const items: RecordedMessage[] = messages.map(
    (m: ToBeRecordedMessage, i: number) => {
      return {
        id: chatId,
        createdDate: m.createdDate ?? `${createdDate + i}#0`,
        messageId: m.messageId,
        role: m.role,
        content: m.content,
        trace: m.trace,
        extraData: m.extraData,
        userId,
        feedback,
        usecase: m.usecase,
        llmType: m.llmType ?? '',
        metadata: m.metadata,
      };
    }
  );

  // Save messages
  await dynamoDbDocument.send(
    new BatchWriteCommand({
      RequestItems: {
        [tableName]: items.map((m) => {
          return {
            PutRequest: {
              Item: m,
            },
          };
        }),
      },
    })
  );

  // Update token usage in parallel
  await Promise.all(items.map(item => updateTokenUsage(item, event)));

  return items;
};

export const setChatTitle = async (
  id: string,
  createdDate: string,
  title: string,
  event: APIGatewayProxyEvent
) => {
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        id: id,
        createdDate: createdDate,
      },
      UpdateExpression: 'set title = :title',
      ExpressionAttributeValues: {
        ':title': title,
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return res.Attributes as Chat;
};

export const updateFeedback = async (
  _chatId: string,
  feedbackData: UpdateFeedbackRequest,
  event: APIGatewayProxyEvent
): Promise<RecordedMessage> => {
  const chatId = `chat#${_chatId}`;
  const { createdDate, feedback, reasons, detailedFeedback } = feedbackData;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  let updateExpression = 'set feedback = :feedback';
  const expressionAttributeValues: {
    ':feedback': string;
    ':reasons'?: string[];
    ':detailedFeedback'?: string;
  } = {
    ':feedback': feedback,
  };

  if (reasons && reasons.length > 0) {
    updateExpression += ', reasons = :reasons';
    expressionAttributeValues[':reasons'] = reasons;
  }

  if (detailedFeedback) {
    updateExpression += ', detailedFeedback = :detailedFeedback';
    expressionAttributeValues[':detailedFeedback'] = detailedFeedback;
  }

  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        id: chatId,
        createdDate,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as RecordedMessage;
};

export const deleteChat = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<void> => {
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  // Delete Chat
  const chatItem = await findChatById(_userId, _chatId, event);
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        id: chatItem?.id,
        createdDate: chatItem?.createdDate,
      },
    })
  );

  // Delete Messages
  const messageItems = await listMessages(_chatId, event);
  await dynamoDbDocument.send(
    new BatchWriteCommand({
      RequestItems: {
        [tableName]: messageItems.map((m) => {
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
};

export const updateSystemContextTitle = async (
  _userId: string,
  _systemContextId: string,
  title: string,
  event: APIGatewayProxyEvent
): Promise<SystemContext> => {
  const systemContext = await findSystemContextById(_userId, _systemContextId, event);
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        id: systemContext?.id,
        createdDate: systemContext?.createdDate,
      },
      UpdateExpression: 'set systemContextTitle = :systemContextTitle',
      ExpressionAttributeValues: {
        ':systemContextTitle': title,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as SystemContext;
};

export const deleteSystemContext = async (
  _userId: string,
  _systemContextId: string,
  event: APIGatewayProxyEvent
): Promise<void> => {
  // Delete System Context
  const systemContext = await findSystemContextById(_userId, _systemContextId, event);
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        id: systemContext?.id,
        createdDate: systemContext?.createdDate,
      },
    })
  );
};

export const createShareId = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<{
  shareId: ShareId;
  userIdAndChatId: UserIdAndChatId;
}> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const createdDate = `${Date.now()}`;
  const shareId = `share#${crypto.randomUUID()}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);

  const itemShareId = {
    id: `${userId}_${chatId}`,
    createdDate,
    shareId,
  };

  const itemUserIdAndChatId = {
    id: shareId,
    createdDate,
    userId,
    chatId,
  };

  await dynamoDbDocument.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: itemShareId,
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: itemUserIdAndChatId,
          },
        },
      ],
    })
  );

  return {
    shareId: itemShareId,
    userIdAndChatId: itemUserIdAndChatId,
  };
};

export const findUserIdAndChatId = async (
  _shareId: string,
  event: APIGatewayProxyEvent
): Promise<UserIdAndChatId | null> => {
  const shareId = `share#${_shareId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': shareId,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  } else {
    return res.Items[0] as UserIdAndChatId;
  }
};

export const findShareId = async (
  _userId: string,
  _chatId: string,
  event: APIGatewayProxyEvent
): Promise<ShareId | null> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': `${userId}_${chatId}`,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  } else {
    return res.Items[0] as ShareId;
  }
};

export const deleteShareId = async (_shareId: string, event: APIGatewayProxyEvent): Promise<void> => {
  const tableName = getTableNameForTenant('TABLE_NAME', event);
  const userIdAndChatId = await findUserIdAndChatId(_shareId, event);
  const share = await findShareId(
    // SAML authentication includes # in userId
    // Example: user#EntraID_hogehoge.com#EXT#@hogehoge.onmicrosoft.com
    userIdAndChatId!.userId.split('#').slice(1).join('#'),
    userIdAndChatId!.chatId.split('#')[1],
    event
  );

  await dynamoDbDocument.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: {
              id: share!.id,
              createdDate: share!.createdDate,
            },
          },
        },
        {
          Delete: {
            TableName: tableName,
            Key: {
              id: userIdAndChatId!.id,
              createdDate: userIdAndChatId!.createdDate,
            },
          },
        },
      ],
    })
  );
};

export const aggregateTokenUsage = async (
  startDate: string,
  endDate: string,
  event: APIGatewayProxyEvent,
  userIds?: string[]
): Promise<TokenUsageStats[]> => {
  const userId = userIds?.[0];
  if (!userId) {
    throw new Error('userId is required');
  }
  
  const statsTableName = getTableNameForTenant('STATS_TABLE_NAME', event);

  try {
    // Initialize all dates in the date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const statsMap = new Map<string, TokenUsageStats>();

    // Create keys for BatchGetItem
    const keys = [];
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      statsMap.set(dateStr, {
        date: dateStr,
        userId,
        executions: { overall: 0 },
        inputTokens: { overall: 0 },
        outputTokens: { overall: 0 },
        cacheReadInputTokens: { overall: 0 },
        cacheWriteInputTokens: { overall: 0 },
      });

      keys.push({
        id: `stats#${dateStr}`,
        userId: userId,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // BatchGetItem supports up to 100 items per request
    // Split keys into chunks if necessary
    const chunkSize = 100;
    const keyChunks = [];
    for (let i = 0; i < keys.length; i += chunkSize) {
      keyChunks.push(keys.slice(i, i + chunkSize));
    }

    // Execute BatchGetItem for each chunk
    const batchPromises = keyChunks.map((chunk) =>
      dynamoDbDocument.send(
        new BatchGetCommand({
          RequestItems: {
            [statsTableName]: {
              Keys: chunk,
            },
          },
        })
      )
    );

    const batchResults = await Promise.all(batchPromises);

    // Update the map with the retrieved data
    batchResults.forEach((result) => {
      result.Responses?.[statsTableName]?.forEach((item) => {
        const stats = item as TokenUsageStats;
        if (stats.date) {
          statsMap.set(stats.date, stats);
        }
      });
    });

    // Convert to array and sort
    return Array.from(statsMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  } catch (error) {
    console.error('Error aggregating token usage:', error);
    throw error;
  }
};
