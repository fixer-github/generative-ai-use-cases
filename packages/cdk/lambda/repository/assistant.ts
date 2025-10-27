import {
  Assistant,
  ListAssistantsResponse,
  CreateAssistantRequest,
  UpdateAssistantRequest,
} from 'generative-ai-use-cases';
import * as crypto from 'crypto';
import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  getTenantDynamoDBDocument,
  executeDynamoDBOperation,
  getAssistantTableName,
} from './common';

export const createAssistant = async (
  _userId: string,
  data: CreateAssistantRequest,
  event: APIGatewayProxyEvent
): Promise<Assistant> => {
  const userId = `user#${_userId}`;
  const assistantId = `assistant#${crypto.randomUUID()}`;
  const now = Date.now().toString();

  const item: Assistant = {
    id: userId,
    createdDate: now,
    assistantId,
    userId,
    name: data.name,
    description: data.description,
    instruction: data.instruction,
    modelId: data.modelId,
    ragEnabled: data.ragEnabled,
    syncStatus: 'QUEUED',
    syncStatusReason: '',
    s3Urls: data.s3Urls || [],
    updatedDate: now,
  };

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getAssistantTableName(event);

  await dynamoDbDocument.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    })
  );

  return item;
};

export const listAssistants = async (
  _userId: string,
  event: APIGatewayProxyEvent,
  _exclusiveStartKey?: string
): Promise<ListAssistantsResponse> => {
  const userId = `user#${_userId}`;
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getAssistantTableName(event);

  const exclusiveStartKey = _exclusiveStartKey
    ? JSON.parse(Buffer.from(_exclusiveStartKey, 'base64').toString())
    : undefined;

  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: {
        '#userId': 'userId',
      },
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: exclusiveStartKey,
    })
  );

  return {
    assistants: res.Items as Assistant[],
    lastEvaluatedKey: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
};

export const getAssistant = async (
  _assistantId: string,
  event: APIGatewayProxyEvent
): Promise<Assistant | null> => {
  const assistantId = `assistant#${_assistantId}`;
  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getAssistantTableName(event);

  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'AssistantIdIndex',
      KeyConditionExpression: '#assistantId = :assistantId',
      ExpressionAttributeNames: {
        '#assistantId': 'assistantId',
      },
      ExpressionAttributeValues: {
        ':assistantId': assistantId,
      },
    })
  );

  if (!res.Items || res.Items.length === 0) {
    return null;
  }

  return res.Items[0] as Assistant;
};

export const updateAssistant = async (
  _assistantId: string,
  _userId: string,
  updates: UpdateAssistantRequest,
  event: APIGatewayProxyEvent
): Promise<Assistant> => {
  const assistantId = `assistant#${_assistantId}`;
  const userId = `user#${_userId}`;

  // First get the assistant to get the createdDate (sort key)
  const existing = await getAssistant(_assistantId, event);
  if (!existing) {
    throw new Error('Assistant not found');
  }

  // Verify ownership
  if (existing.userId !== userId) {
    throw new Error('Unauthorized');
  }

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getAssistantTableName(event);

  // Build update expression
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  if (updates.name !== undefined) {
    updateExpressions.push('#name = :name');
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = updates.name;
  }
  if (updates.description !== undefined) {
    updateExpressions.push('#description = :description');
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = updates.description;
  }
  if (updates.instruction !== undefined) {
    updateExpressions.push('#instruction = :instruction');
    expressionAttributeNames['#instruction'] = 'instruction';
    expressionAttributeValues[':instruction'] = updates.instruction;
  }
  if (updates.modelId !== undefined) {
    updateExpressions.push('#modelId = :modelId');
    expressionAttributeNames['#modelId'] = 'modelId';
    expressionAttributeValues[':modelId'] = updates.modelId;
  }
  if (updates.ragEnabled !== undefined) {
    updateExpressions.push('#ragEnabled = :ragEnabled');
    expressionAttributeNames['#ragEnabled'] = 'ragEnabled';
    expressionAttributeValues[':ragEnabled'] = updates.ragEnabled;
  }
  if (updates.s3Urls !== undefined) {
    updateExpressions.push('#s3Urls = :s3Urls');
    expressionAttributeNames['#s3Urls'] = 's3Urls';
    expressionAttributeValues[':s3Urls'] = updates.s3Urls;
  }

  // Always update updatedDate
  updateExpressions.push('#updatedDate = :updatedDate');
  expressionAttributeNames['#updatedDate'] = 'updatedDate';
  expressionAttributeValues[':updatedDate'] = Date.now().toString();

  const res = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        userId: existing.id,
        createdDate: existing.createdDate,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );

  return res.Attributes as Assistant;
};

export const deleteAssistant = async (
  _assistantId: string,
  _userId: string,
  event: APIGatewayProxyEvent
): Promise<void> => {
  const assistantId = `assistant#${_assistantId}`;
  const userId = `user#${_userId}`;

  // First get the assistant to verify ownership and get keys
  const existing = await getAssistant(_assistantId, event);
  if (!existing) {
    throw new Error('Assistant not found');
  }

  // Verify ownership
  if (existing.userId !== userId) {
    throw new Error('Unauthorized');
  }

  const dynamoDbDocument = await getTenantDynamoDBDocument(event);
  const tableName = getAssistantTableName(event);

  await dynamoDbDocument.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        userId: existing.id,
        createdDate: existing.createdDate,
      },
    })
  );
};
