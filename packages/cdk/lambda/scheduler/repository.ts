/**
 * Scheduler Repository
 *
 * DynamoDB Key Design:
 *
 * 1. Scheduled Task Records:
 *    - PK: scheduledTask#{userId}
 *    - SK: {taskId}
 *    - Purpose: Store user's scheduled tasks
 *
 * 2. Task Execution Records:
 *    - PK: taskExecution#{taskId}
 *    - SK: {executionId}  ({taskId}#{scheduledTime})
 *    - Purpose: Store execution logs per task
 *
 * 3. User Notification Info:
 *    - PK: userNotification#{userId}
 *    - SK: info
 *    - Purpose: Store user's SNS topic ARN
 *
 * GSI (UserExecutionIndex):
 *    - GSI PK: userExecution#{userId}
 *    - GSI SK: {startedAt}
 *    - Projected: executionId, taskId, status, startedAt, completedAt
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ScheduledTask,
  TaskExecution,
  ScheduledTaskResponse,
  TaskExecutionSummary,
  TaskExecutionDetail,
  UserNotificationInfo,
} from './types';

const TABLE_NAME: string = process.env.SCHEDULER_TABLE_NAME!;
const USER_EXECUTION_INDEX = 'UserExecutionIndex';

const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

// --- Helper: Convert ScheduledTask to API response ---

function toTaskResponse(task: ScheduledTask): ScheduledTaskResponse {
  return {
    taskId: task.taskId,
    taskName: task.taskName,
    prompt: task.prompt,
    agentName: task.agentName,
    modelId: task.modelId,
    schedule: task.schedule,
    enabled: task.enabled,
    updatedAt: task.updatedAt,
  };
}

function toExecutionSummary(exec: TaskExecution): TaskExecutionSummary {
  return {
    executionId: exec.executionId,
    taskId: exec.taskId,
    status: exec.status,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt,
  };
}

function toExecutionDetail(exec: TaskExecution): TaskExecutionDetail {
  return {
    executionId: exec.executionId,
    taskId: exec.taskId,
    status: exec.status,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt,
    resultText: exec.resultText,
    errorMessage: exec.errorMessage,
    tokenUsage: exec.tokenUsage,
    emailSent: exec.emailSent,
  };
}

// --- Scheduled Task CRUD ---

export const createTask = async (
  task: ScheduledTask
): Promise<ScheduledTaskResponse> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: task,
    })
  );
  return toTaskResponse(task);
};

export const getTask = async (
  userId: string,
  taskId: string
): Promise<ScheduledTask | null> => {
  const result = await dynamoDbDocument.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `scheduledTask#${userId}`,
        sk: taskId,
      },
    })
  );
  if (!result.Item) return null;
  const task = result.Item as ScheduledTask;
  if (task.deleted) return null;
  return task;
};

/**
 * Get task including logically deleted ones (for ownership check on execution logs)
 */
export const getTaskIncludingDeleted = async (
  userId: string,
  taskId: string
): Promise<ScheduledTask | null> => {
  const result = await dynamoDbDocument.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `scheduledTask#${userId}`,
        sk: taskId,
      },
    })
  );
  return result.Item ? (result.Item as ScheduledTask) : null;
};

export const listTasks = async (
  userId: string
): Promise<ScheduledTaskResponse[]> => {
  const result = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      FilterExpression: '#deleted <> :true',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#deleted': 'deleted',
      },
      ExpressionAttributeValues: {
        ':pk': `scheduledTask#${userId}`,
        ':true': true,
      },
    })
  );
  return (result.Items || []).map((item) =>
    toTaskResponse(item as ScheduledTask)
  );
};

export const countTasks = async (userId: string): Promise<number> => {
  const result = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      FilterExpression: '#deleted <> :true',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#deleted': 'deleted',
      },
      ExpressionAttributeValues: {
        ':pk': `scheduledTask#${userId}`,
        ':true': true,
      },
      Select: 'COUNT',
    })
  );
  return result.Count || 0;
};

export const updateTask = async (
  userId: string,
  taskId: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'taskName'
      | 'prompt'
      | 'agentName'
      | 'modelId'
      | 'schedule'
      | 'enabled'
      | 'eventBridgeScheduleName'
    >
  >
): Promise<ScheduledTaskResponse> => {
  const expressionParts: string[] = ['#updatedAt = :updatedAt'];
  const expressionNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
  };
  const expressionValues: Record<string, unknown> = {
    ':updatedAt': new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      expressionParts.push(`${attrName} = ${attrValue}`);
      expressionNames[attrName] = key;
      expressionValues[attrValue] = value;
    }
  }

  const result = await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `scheduledTask#${userId}`,
        sk: taskId,
      },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    })
  );
  return toTaskResponse(result.Attributes as ScheduledTask);
};

export const deleteTask = async (
  userId: string,
  taskId: string
): Promise<void> => {
  await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `scheduledTask#${userId}`,
        sk: taskId,
      },
      UpdateExpression:
        'SET #deleted = :true, #enabled = :false, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#deleted': 'deleted',
        '#enabled': 'enabled',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':true': true,
        ':false': false,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );
};

// --- Task Execution CRUD ---

/**
 * Create execution log with idempotency check.
 * Returns true if created, false if already exists (duplicate execution).
 */
export const createExecution = async (
  execution: TaskExecution
): Promise<boolean> => {
  try {
    await dynamoDbDocument.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: execution,
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return false; // Duplicate execution
    }
    throw error;
  }
};

export const updateExecutionStatus = async (
  taskId: string,
  executionId: string,
  updates: {
    status: 'success' | 'error';
    resultText?: string;
    errorMessage?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    emailSent?: boolean;
    completedAt: string;
  }
): Promise<void> => {
  const expressionParts: string[] = [
    '#status = :status',
    '#completedAt = :completedAt',
  ];
  const expressionNames: Record<string, string> = {
    '#status': 'status',
    '#completedAt': 'completedAt',
  };
  const expressionValues: Record<string, unknown> = {
    ':status': updates.status,
    ':completedAt': updates.completedAt,
  };

  if (updates.resultText !== undefined) {
    expressionParts.push('#resultText = :resultText');
    expressionNames['#resultText'] = 'resultText';
    expressionValues[':resultText'] = updates.resultText;
  }
  if (updates.errorMessage !== undefined) {
    expressionParts.push('#errorMessage = :errorMessage');
    expressionNames['#errorMessage'] = 'errorMessage';
    expressionValues[':errorMessage'] = updates.errorMessage;
  }
  if (updates.tokenUsage !== undefined) {
    expressionParts.push('#tokenUsage = :tokenUsage');
    expressionNames['#tokenUsage'] = 'tokenUsage';
    expressionValues[':tokenUsage'] = updates.tokenUsage;
  }
  if (updates.emailSent !== undefined) {
    expressionParts.push('#emailSent = :emailSent');
    expressionNames['#emailSent'] = 'emailSent';
    expressionValues[':emailSent'] = updates.emailSent;
  }

  await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `taskExecution#${taskId}`,
        sk: executionId,
      },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
    })
  );
};

export const listExecutions = async (
  taskId: string,
  limit: number = 20
): Promise<TaskExecutionSummary[]> => {
  const result = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': 'pk',
      },
      ExpressionAttributeValues: {
        ':pk': `taskExecution#${taskId}`,
      },
      ScanIndexForward: false, // Newest first
      Limit: limit,
    })
  );
  return (result.Items || []).map((item) =>
    toExecutionSummary(item as TaskExecution)
  );
};

export const getExecution = async (
  taskId: string,
  executionId: string
): Promise<TaskExecutionDetail | null> => {
  const result = await dynamoDbDocument.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `taskExecution#${taskId}`,
        sk: executionId,
      },
    })
  );
  return result.Item ? toExecutionDetail(result.Item as TaskExecution) : null;
};

export const listExecutionsByUser = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<TaskExecutionSummary[]> => {
  const result = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: USER_EXECUTION_INDEX,
      KeyConditionExpression:
        '#gsiPk = :gsiPk AND #gsiSk BETWEEN :start AND :end',
      ExpressionAttributeNames: {
        '#gsiPk': 'gsiPk',
        '#gsiSk': 'gsiSk',
      },
      ExpressionAttributeValues: {
        ':gsiPk': `userExecution#${userId}`,
        ':start': startDate,
        ':end': endDate,
      },
    })
  );
  return (result.Items || []).map((item) =>
    toExecutionSummary(item as TaskExecution)
  );
};

// --- User Notification Info ---

export const getUserNotificationInfo = async (
  userId: string
): Promise<UserNotificationInfo | null> => {
  const result = await dynamoDbDocument.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `userNotification#${userId}`,
        sk: 'info',
      },
    })
  );
  return result.Item ? (result.Item as UserNotificationInfo) : null;
};

export const saveUserNotificationInfo = async (
  userId: string,
  info: UserNotificationInfo
): Promise<void> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `userNotification#${userId}`,
        sk: 'info',
        ...info,
      },
    })
  );
};
