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
  Meeting,
  MeetingSource,
  MeetingSpeaker,
  ListMeetingsResponse,
  UpdateMeetingRequest,
  StoredNotification,
  NotificationType,
  ListNotificationsResponse,
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

const TABLE_NAME: string = process.env.TABLE_NAME!;
const STATS_TABLE_NAME: string = process.env.STATS_TABLE_NAME!;
const MEETING_TABLE_NAME: string = process.env.MEETING_TABLE_NAME!;
// Only set on notification-aware lambdas (notification API + B3 meeting
// completion). Other lambdas import this module without the var; the
// `!` is compile-time only, so the const is simply unused at runtime there.
const NOTIFICATION_TABLE_NAME: string = process.env.NOTIFICATION_TABLE_NAME!;
const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

export const createChat = async (_userId: string): Promise<Chat> => {
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
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return item;
};

export const findChatById = async (
  _userId: string,
  _chatId: string
): Promise<Chat | null> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
  _systemContextId: string
): Promise<SystemContext | null> => {
  const userId = `systemContext#${_userId}`;
  const systemContextId = `systemContext#${_systemContextId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
  _exclusiveStartKey?: string
): Promise<ListChatsResponse> => {
  const exclusiveStartKey = _exclusiveStartKey
    ? JSON.parse(Buffer.from(_exclusiveStartKey, 'base64').toString())
    : undefined;
  const userId = `user#${_userId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
  _userId: string
): Promise<SystemContext[]> => {
  const userId = `systemContext#${_userId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
  systemContext: string
): Promise<SystemContext> => {
  const userId = `systemContext#${_userId}`;
  const systemContextId = `systemContext#${crypto.randomUUID()}`;
  const item = {
    id: userId,
    createdDate: `${Date.now()}`,
    systemContextId: systemContextId,
    systemContext: systemContext,
    systemContextTitle: title,
  };

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  return item;
};

export const listMessages = async (
  _chatId: string
): Promise<RecordedMessage[]> => {
  const chatId = `chat#${_chatId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
async function updateTokenUsage(message: RecordedMessage): Promise<void> {
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

  try {
    // Try to update with shallow nesting structure
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: STATS_TABLE_NAME,
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
          TableName: STATS_TABLE_NAME,
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
  _chatId: string
): Promise<RecordedMessage[]> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const createdDate = Date.now();
  const feedback = 'none';

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
        ...(m.agentRunId && { agentRunId: m.agentRunId }),
        ...(m.agentId && { agentId: m.agentId }),
      };
    }
  );

  // Save messages
  await dynamoDbDocument.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: items.map((m) => {
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
  await Promise.all(items.map(updateTokenUsage));

  return items;
};

export const setChatTitle = async (
  id: string,
  createdDate: string,
  title: string
) => {
  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
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
  feedbackData: UpdateFeedbackRequest
): Promise<RecordedMessage> => {
  const chatId = `chat#${_chatId}`;
  const { createdDate, feedback, reasons, detailedFeedback } = feedbackData;
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
      TableName: TABLE_NAME,
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
  _chatId: string
): Promise<void> => {
  // Delete Chat
  const chatItem = await findChatById(_userId, _chatId);
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        id: chatItem?.id,
        createdDate: chatItem?.createdDate,
      },
    })
  );

  // Delete Messages
  const messageItems = await listMessages(_chatId);

  // Split into chunks of 25 (DynamoDB BatchWrite limit)
  const chunkSize = 25;
  for (let i = 0; i < messageItems.length; i += chunkSize) {
    const chunk = messageItems.slice(i, i + chunkSize);
    await dynamoDbDocument.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((m) => {
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
};

export const updateSystemContextTitle = async (
  _userId: string,
  _systemContextId: string,
  title: string
): Promise<SystemContext> => {
  const systemContext = await findSystemContextById(_userId, _systemContextId);
  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
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
  _systemContextId: string
): Promise<void> => {
  // Delete System Context
  const systemContext = await findSystemContextById(_userId, _systemContextId);
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        id: systemContext?.id,
        createdDate: systemContext?.createdDate,
      },
    })
  );
};

export const createShareId = async (
  _userId: string,
  _chatId: string
): Promise<{
  shareId: ShareId;
  userIdAndChatId: UserIdAndChatId;
}> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const createdDate = `${Date.now()}`;
  const shareId = `share#${crypto.randomUUID()}`;

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
            TableName: TABLE_NAME,
            Item: itemShareId,
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
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
  _shareId: string
): Promise<UserIdAndChatId | null> => {
  const shareId = `share#${_shareId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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
  _chatId: string
): Promise<ShareId | null> => {
  const userId = `user#${_userId}`;
  const chatId = `chat#${_chatId}`;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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

export const deleteShareId = async (_shareId: string): Promise<void> => {
  const userIdAndChatId = await findUserIdAndChatId(_shareId);
  const share = await findShareId(
    // SAML authentication includes # in userId
    // Example: user#EntraID_hogehoge.com#EXT#@hogehoge.onmicrosoft.com
    userIdAndChatId!.userId.split('#').slice(1).join('#'),
    userIdAndChatId!.chatId.split('#')[1]
  );

  await dynamoDbDocument.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: {
              id: share!.id,
              createdDate: share!.createdDate,
            },
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
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
  userIds?: string[]
): Promise<TokenUsageStats[]> => {
  const userId = userIds?.[0];
  if (!userId) {
    throw new Error('userId is required');
  }

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
            [STATS_TABLE_NAME]: {
              Keys: chunk,
            },
          },
        })
      )
    );

    const batchResults = await Promise.all(batchPromises);

    // Update the map with the retrieved data
    batchResults.forEach((result) => {
      result.Responses?.[STATS_TABLE_NAME]?.forEach((item) => {
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

// ---------------------------------------------------------------------------
// Meeting (minutes) workbench
//
// The dedicated MeetingTable is the source of truth. On create/update we also
// write a lightweight projection row to the main table (usecase === 'minutes')
// so the sidebar history (listChats) can list meetings with no schema change.
// The projection row shares the meeting's SK (createdDate), so its key is
// reconstructable as { id: `user#${userId}`, createdDate: meeting.createdDate }
// without an extra query. See the Phase 2 meeting-workbench design memo, 1.2.
// ---------------------------------------------------------------------------

export const createMeeting = async (
  _userId: string,
  source: MeetingSource,
  title?: string
): Promise<Meeting> => {
  const meetingPk = `meeting#${_userId}`;
  const userPk = `user#${_userId}`;
  const createdDate = `${Date.now()}`;
  const uuid = crypto.randomUUID();
  const meetingId = `meeting#${uuid}`;
  // mic sessions start recording; batch uploads start in transcribing.
  const status = source === 'mic' ? 'recording' : 'transcribing';

  const meeting: Meeting = {
    id: meetingPk,
    createdDate,
    meetingId,
    title: title ?? '',
    status,
    source,
    speakers: [],
    rev: 0,
    updatedDate: createdDate,
  };

  // 1) Meeting entity (source of truth) -> dedicated MeetingTable
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: MEETING_TABLE_NAME,
      Item: meeting,
    })
  );

  // 2) Projection row -> main table, picked up by listChats (sidebar history)
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        id: userPk,
        createdDate,
        chatId: `chat#${uuid}`,
        usecase: 'minutes',
        title: title ?? '',
        meetingId,
        status,
        updatedDate: createdDate,
      },
    })
  );

  return meeting;
};

export const listMeetings = async (
  _userId: string,
  _exclusiveStartKey?: string
): Promise<ListMeetingsResponse> => {
  const exclusiveStartKey = _exclusiveStartKey
    ? JSON.parse(Buffer.from(_exclusiveStartKey, 'base64').toString())
    : undefined;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: MEETING_TABLE_NAME,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': `meeting#${_userId}`,
      },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  return {
    data: res.Items as Meeting[],
    lastEvaluatedKey: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
};

export const findMeetingById = async (
  _userId: string,
  _meetingId: string
): Promise<Meeting | null> => {
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: MEETING_TABLE_NAME,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#meetingId = :meetingId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#meetingId': 'meetingId',
      },
      ExpressionAttributeValues: {
        ':id': `meeting#${_userId}`,
        ':meetingId': `meeting#${_meetingId}`,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  } else {
    return res.Items[0] as Meeting;
  }
};

export const updateMeeting = async (
  _userId: string,
  _meetingId: string,
  patch: UpdateMeetingRequest
): Promise<Meeting> => {
  const meeting = await findMeetingById(_userId, _meetingId);
  if (!meeting) {
    throw new Error('Meeting not found');
  }
  const updatedDate = `${Date.now()}`;

  type AttrVal = string | number | MeetingSpeaker[];
  const fields: (keyof UpdateMeetingRequest)[] = [
    'title',
    'status',
    'jobName',
    'transcriptKey',
    'minutesKey',
    'audioKey',
    'speakers',
    'rev',
    'genRev',
  ];
  const sets: string[] = ['#updatedDate = :updatedDate'];
  const names: Record<string, string> = { '#updatedDate': 'updatedDate' };
  const values: Record<string, AttrVal> = { ':updatedDate': updatedDate };
  for (const f of fields) {
    const v = patch[f];
    if (v !== undefined) {
      sets.push(`#${f} = :${f}`);
      names[`#${f}`] = f;
      values[`:${f}`] = v as AttrVal;
    }
  }

  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: MEETING_TABLE_NAME,
      Key: {
        id: meeting.id,
        createdDate: meeting.createdDate,
      },
      UpdateExpression: `set ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );
  const updated = res.Attributes as Meeting;

  // Mirror title/status onto the projection row (shares the meeting's SK).
  if (patch.title !== undefined || patch.status !== undefined) {
    const projSets: string[] = ['#updatedDate = :updatedDate'];
    const projNames: Record<string, string> = { '#updatedDate': 'updatedDate' };
    const projValues: Record<string, AttrVal> = {
      ':updatedDate': updatedDate,
    };
    if (patch.title !== undefined) {
      projSets.push('#title = :title');
      projNames['#title'] = 'title';
      projValues[':title'] = patch.title;
    }
    if (patch.status !== undefined) {
      projSets.push('#status = :status');
      projNames['#status'] = 'status';
      projValues[':status'] = patch.status;
    }
    await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          id: `user#${_userId}`,
          createdDate: meeting.createdDate,
        },
        UpdateExpression: `set ${projSets.join(', ')}`,
        ExpressionAttributeNames: projNames,
        ExpressionAttributeValues: projValues,
      })
    );
  }

  return updated;
};

// Delete the meeting body (MeetingTable) and its projection row (main table).
// Returns the deleted meeting so the caller can clean up its S3 objects
// (transcript / minutes / audio). S3 cleanup lives in the lambda, which holds
// the bucket grant. See Phase 2 meeting-workbench memo 8.5.
export const deleteMeeting = async (
  _userId: string,
  _meetingId: string
): Promise<Meeting | null> => {
  const meeting = await findMeetingById(_userId, _meetingId);
  if (!meeting) {
    return null;
  }

  // 1) Meeting entity (source of truth)
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: MEETING_TABLE_NAME,
      Key: {
        id: meeting.id,
        createdDate: meeting.createdDate,
      },
    })
  );

  // 2) Projection row in the main table (shares the meeting's SK)
  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        id: `user#${_userId}`,
        createdDate: meeting.createdDate,
      },
    })
  );

  return meeting;
};

// ---------------------------------------------------------------------------
// Notifications (P4 / B6)
//
// The dedicated NotificationTable is the source of truth for the sidebar bell.
// Notifications are produced by backend Lambdas only (B3 meeting completion;
// the scheduler execution Lambda has its own writer because it lives in a
// separate construct and cannot import this module). They are NOT projected
// into the Chat table — they belong in the bell, not sidebar history.
// id = `notification#${userId}` (PK), createdDate = `${epochMs}` (SK, newest
// first). See the Phase 2 common-infrastructure-cluster memo, section 4.
// ---------------------------------------------------------------------------

// Notifications self-expire via DynamoDB TTL after this many days.
const NOTIFICATION_TTL_DAYS = 90;

export const createNotification = async (
  _userId: string,
  input: {
    type: NotificationType;
    title: string;
    body?: string;
    link: string;
  }
): Promise<StoredNotification> => {
  const createdDate = `${Date.now()}`;
  const notification: StoredNotification = {
    id: `notification#${_userId}`,
    createdDate,
    notificationId: `notification#${crypto.randomUUID()}`,
    type: input.type,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    link: input.link,
    read: false,
    ttl: Math.floor(Date.now() / 1000) + NOTIFICATION_TTL_DAYS * 24 * 60 * 60,
  };

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      Item: notification,
    })
  );

  return notification;
};

export const listNotifications = async (
  _userId: string,
  _exclusiveStartKey?: string
): Promise<ListNotificationsResponse> => {
  const exclusiveStartKey = _exclusiveStartKey
    ? JSON.parse(Buffer.from(_exclusiveStartKey, 'base64').toString())
    : undefined;
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': `notification#${_userId}`,
      },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  return {
    data: res.Items as StoredNotification[],
    lastEvaluatedKey: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
};

const findNotificationById = async (
  _userId: string,
  _notificationId: string
): Promise<StoredNotification | null> => {
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#notificationId = :notificationId',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#notificationId': 'notificationId',
      },
      ExpressionAttributeValues: {
        ':id': `notification#${_userId}`,
        ':notificationId': `notification#${_notificationId}`,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  }
  return res.Items[0] as StoredNotification;
};

export const markNotificationRead = async (
  _userId: string,
  _notificationId: string
): Promise<StoredNotification | null> => {
  const notification = await findNotificationById(_userId, _notificationId);
  if (!notification) {
    return null;
  }

  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      Key: {
        id: notification.id,
        createdDate: notification.createdDate,
      },
      UpdateExpression: 'set #read = :read',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: { ':read': true },
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as StoredNotification;
};

export const markAllNotificationsRead = async (
  _userId: string
): Promise<number> => {
  // Notification volume per user is small (bell-only, 90-day TTL), so a single
  // unread scan + per-row update is sufficient; no pagination loop needed.
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      KeyConditionExpression: '#id = :id',
      FilterExpression: '#read = :false',
      ExpressionAttributeNames: { '#id': 'id', '#read': 'read' },
      ExpressionAttributeValues: {
        ':id': `notification#${_userId}`,
        ':false': false,
      },
    })
  );

  const unread = (res.Items as StoredNotification[] | undefined) ?? [];
  await Promise.all(
    unread.map((n) =>
      dynamoDbDocument.send(
        new UpdateCommand({
          TableName: NOTIFICATION_TABLE_NAME,
          Key: { id: n.id, createdDate: n.createdDate },
          UpdateExpression: 'set #read = :read',
          ExpressionAttributeNames: { '#read': 'read' },
          ExpressionAttributeValues: { ':read': true },
        })
      )
    )
  );

  return unread.length;
};
