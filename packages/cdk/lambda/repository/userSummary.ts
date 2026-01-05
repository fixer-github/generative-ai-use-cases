import {
  DailySummary,
  UserSummary,
  UserSummaryConfig,
} from 'generative-ai-use-cases';
import {
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantDynamoDBDocument, getUserSummaryTableName } from './common';
import { getTenantId } from '../utils/tenantUtils';

// Sort key prefixes for different summary types
const DAILY_PREFIX = 'DAILY#';
const USER_SUMMARY_SK = 'USER_SUMMARY';
const CONFIG_SK = 'CONFIG';

/**
 * Get yesterday's date in YYYY-MM-DD format (JST timezone)
 */
export function getYesterdayDate(): string {
  const now = new Date();
  // Convert to JST (UTC+9)
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  // Subtract one day
  jstNow.setDate(jstNow.getDate() - 1);
  return jstNow.toISOString().split('T')[0];
}

/**
 * Get today's date in YYYY-MM-DD format (JST timezone)
 */
export function getTodayDate(): string {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  return jstNow.toISOString().split('T')[0];
}

/**
 * Calculate term start date based on unit and value
 */
export function calculateTermStart(
  termUnit: 'month' | 'year',
  termValue: number,
  endDate: string
): string {
  const end = new Date(endDate);
  if (termUnit === 'month') {
    end.setMonth(end.getMonth() - termValue);
  } else {
    end.setFullYear(end.getFullYear() - termValue);
  }
  return end.toISOString().split('T')[0];
}

/**
 * Get daily summary for a specific user and date
 */
export const getDailySummary = async (
  _userId: string,
  date: string,
  event: APIGatewayProxyEvent
): Promise<DailySummary | null> => {
  const userId = _userId.startsWith('user#') ? _userId : `user#${_userId}`;
  const sortKey = `${DAILY_PREFIX}${date}`;

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        id: userId,
        createdDate: sortKey,
      },
    })
  );

  return res.Item ? (res.Item as DailySummary) : null;
};

/**
 * Get yesterday's daily summary for a user
 */
export const getYesterdayDailySummary = async (
  userId: string,
  event: APIGatewayProxyEvent
): Promise<DailySummary | null> => {
  const yesterday = getYesterdayDate();
  return getDailySummary(userId, yesterday, event);
};

/**
 * Get user summary (aggregated profile)
 */
export const getUserSummary = async (
  _userId: string,
  event: APIGatewayProxyEvent
): Promise<UserSummary | null> => {
  const userId = _userId.startsWith('user#') ? _userId : `user#${_userId}`;

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        id: userId,
        createdDate: USER_SUMMARY_SK,
      },
    })
  );

  return res.Item ? (res.Item as UserSummary) : null;
};

/**
 * Get user summary configuration
 */
export const getUserSummaryConfig = async (
  _userId: string,
  event: APIGatewayProxyEvent
): Promise<UserSummaryConfig | null> => {
  const userId = _userId.startsWith('user#') ? _userId : `user#${_userId}`;

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        id: userId,
        createdDate: CONFIG_SK,
      },
    })
  );

  return res.Item ? (res.Item as UserSummaryConfig) : null;
};

/**
 * Save daily summary
 */
export const saveDailySummary = async (
  summary: Omit<DailySummary, 'id' | 'createdDate'> & { userId: string },
  event: APIGatewayProxyEvent
): Promise<DailySummary> => {
  const userId = summary.userId.startsWith('user#')
    ? summary.userId
    : `user#${summary.userId}`;
  const sortKey = `${DAILY_PREFIX}${summary.date}`;

  const item: DailySummary = {
    id: userId,
    createdDate: sortKey,
    userId: summary.userId,
    tenantId: summary.tenantId,
    date: summary.date,
    summary: summary.summary,
    chatIds: summary.chatIds,
    messageCount: summary.messageCount,
    externalContext: summary.externalContext,
    generatedAt: summary.generatedAt,
    tokenUsage: summary.tokenUsage,
  };

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

/**
 * Save user summary
 */
export const saveUserSummary = async (
  summary: Omit<UserSummary, 'id' | 'createdDate'> & { userId: string },
  event: APIGatewayProxyEvent
): Promise<UserSummary> => {
  const userId = summary.userId.startsWith('user#')
    ? summary.userId
    : `user#${summary.userId}`;

  const item: UserSummary = {
    id: userId,
    createdDate: USER_SUMMARY_SK,
    userId: summary.userId,
    tenantId: summary.tenantId,
    summary: summary.summary,
    termUnit: summary.termUnit,
    termValue: summary.termValue,
    termStart: summary.termStart,
    termEnd: summary.termEnd,
    dailySummaryDates: summary.dailySummaryDates,
    generatedAt: summary.generatedAt,
    tokenUsage: summary.tokenUsage,
  };

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

/**
 * Save or update user summary configuration
 */
export const saveUserSummaryConfig = async (
  config: Omit<UserSummaryConfig, 'id' | 'createdDate'> & { userId: string },
  event: APIGatewayProxyEvent
): Promise<UserSummaryConfig> => {
  const userId = config.userId.startsWith('user#')
    ? config.userId
    : `user#${config.userId}`;
  const tenantId = getTenantId(event) || 'default';

  const item: UserSummaryConfig = {
    id: userId,
    createdDate: CONFIG_SK,
    userId: config.userId,
    tenantId: tenantId,
    termUnit: config.termUnit,
    termValue: config.termValue,
    externalContextPrompt: config.externalContextPrompt,
    enabled: config.enabled,
  };

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

/**
 * Get daily summaries within a date range for a user
 */
export const getDailySummariesInRange = async (
  _userId: string,
  startDate: string,
  endDate: string,
  event: APIGatewayProxyEvent
): Promise<DailySummary[]> => {
  const userId = _userId.startsWith('user#') ? _userId : `user#${_userId}`;
  const startKey = `${DAILY_PREFIX}${startDate}`;
  const endKey = `${DAILY_PREFIX}${endDate}`;

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const queryParams: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression:
      '#id = :id AND #createdDate BETWEEN :start AND :end',
    ExpressionAttributeNames: {
      '#id': 'id',
      '#createdDate': 'createdDate',
    },
    ExpressionAttributeValues: {
      ':id': userId,
      ':start': startKey,
      ':end': endKey,
    },
    ScanIndexForward: true, // Oldest first
  };

  const summaries: DailySummary[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const res = await dynamoDbDocument.send(new QueryCommand(queryParams));

    if (res.Items) {
      summaries.push(...(res.Items as DailySummary[]));
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return summaries;
};

/**
 * Get all users who have daily summaries on a specific date
 * Uses the DateIndex GSI
 */
export const getUsersWithSummaryOnDate = async (
  date: string,
  event: APIGatewayProxyEvent
): Promise<string[]> => {
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const queryParams: QueryCommandInput = {
    TableName: tableName,
    IndexName: 'DateIndex',
    KeyConditionExpression: '#date = :date',
    ExpressionAttributeNames: {
      '#date': 'date',
    },
    ExpressionAttributeValues: {
      ':date': date,
    },
    ProjectionExpression: 'userId',
  };

  const userIds: string[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey;
    }

    const res = await dynamoDbDocument.send(new QueryCommand(queryParams));

    if (res.Items) {
      userIds.push(...res.Items.map((item) => item.userId as string));
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return [...new Set(userIds)]; // Deduplicate
};

/**
 * Update user summary configuration
 */
export const updateUserSummaryConfig = async (
  _userId: string,
  updates: Partial<Omit<UserSummaryConfig, 'id' | 'createdDate' | 'userId'>>,
  event: APIGatewayProxyEvent
): Promise<UserSummaryConfig | null> => {
  const userId = _userId.startsWith('user#') ? _userId : `user#${_userId}`;

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getUserSummaryTableName(event);

  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  if (updates.termUnit !== undefined) {
    updateExpressions.push('#termUnit = :termUnit');
    expressionAttributeNames['#termUnit'] = 'termUnit';
    expressionAttributeValues[':termUnit'] = updates.termUnit;
  }

  if (updates.termValue !== undefined) {
    updateExpressions.push('#termValue = :termValue');
    expressionAttributeNames['#termValue'] = 'termValue';
    expressionAttributeValues[':termValue'] = updates.termValue;
  }

  if (updates.externalContextPrompt !== undefined) {
    updateExpressions.push('#externalContextPrompt = :externalContextPrompt');
    expressionAttributeNames['#externalContextPrompt'] = 'externalContextPrompt';
    expressionAttributeValues[':externalContextPrompt'] =
      updates.externalContextPrompt;
  }

  if (updates.enabled !== undefined) {
    updateExpressions.push('#enabled = :enabled');
    expressionAttributeNames['#enabled'] = 'enabled';
    expressionAttributeValues[':enabled'] = updates.enabled;
  }

  if (updateExpressions.length === 0) {
    return getUserSummaryConfig(_userId, event);
  }

  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        id: userId,
        createdDate: CONFIG_SK,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes ? (res.Attributes as UserSummaryConfig) : null;
};
