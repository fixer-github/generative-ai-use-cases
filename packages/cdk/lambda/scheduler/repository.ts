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
import { randomUUID } from 'crypto';
import {
  ScheduledTask,
  TaskExecution,
  ScheduledTaskResponse,
  TaskExecutionSummary,
  TaskExecutionDetail,
  TaskStatus,
  TaskLastError,
} from './types';

const TABLE_NAME: string = process.env.SCHEDULER_TABLE_NAME!;
const USER_EXECUTION_INDEX = 'UserExecutionIndex';

// Cross-stack tables (step 5/6). These env vars are only set on the execute
// Lambda (which is granted write access in the Scheduler construct); the API
// Lambda never touches them, so they are read lazily where used.
//   NOTIFICATION_TABLE_NAME -> parent NotificationTable (sidebar bell, B6/P4)
//   MAIN_TABLE_NAME         -> parent main Chat table (execution -> Chat projection, D1)
const NOTIFICATION_TABLE_NAME: string | undefined =
  process.env.NOTIFICATION_TABLE_NAME;
const MAIN_TABLE_NAME: string | undefined = process.env.MAIN_TABLE_NAME;

// Notifications self-expire via DynamoDB TTL after this many days (mirrors the
// main repository's createNotification). Only the bell-facing failure/auto-stop
// types are produced from the scheduler side.
const NOTIFICATION_TTL_DAYS = 90;
type SchedNotificationType = 'sched_failed' | 'sched_paused';

const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

// --- Helper: Convert ScheduledTask to API response ---

/**
 * Derive the lifecycle status. `status` is the source of truth once set; legacy
 * rows (written before step 5) have no `status` and are read as the projection
 * of `enabled` (active/paused). An auto-stopped task carries status='error'.
 */
export function deriveStatus(task: ScheduledTask): TaskStatus {
  return task.status ?? (task.enabled ? 'active' : 'paused');
}

export function toTaskResponse(task: ScheduledTask): ScheduledTaskResponse {
  return {
    taskId: task.taskId,
    taskName: task.taskName,
    prompt: task.prompt,
    agentName: task.agentName,
    modelId: task.modelId,
    schedule: task.schedule,
    enabled: task.enabled,
    updatedAt: task.updatedAt,
    status: deriveStatus(task),
    consecutiveFailures: task.consecutiveFailures ?? 0,
    ...(task.lastError ? { lastError: task.lastError } : {}),
  };
}

function toExecutionSummary(exec: TaskExecution): TaskExecutionSummary {
  return {
    executionId: exec.executionId,
    taskId: exec.taskId,
    status: exec.status,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt,
    errorCategory: exec.errorCategory,
    attempt: exec.attempt,
    trigger: exec.trigger,
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
    errorCategory: exec.errorCategory,
    attempt: exec.attempt,
    trigger: exec.trigger,
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

/**
 * Persist runtime lifecycle state written by the execute Lambda's failure
 * handler (step 5): status, the consecutive-failure counter, and lastError.
 * `enabled` is kept in sync as the derived projection of `status` so the
 * execute-Lambda guard and the old UI continue to read the right flag.
 * Passing `lastError: null` removes the attribute (used on success/re-enable).
 */
export const updateTaskRuntime = async (
  userId: string,
  taskId: string,
  updates: {
    status?: TaskStatus;
    consecutiveFailures?: number;
    lastError?: TaskLastError | null;
  }
): Promise<void> => {
  const setParts: string[] = ['#updatedAt = :updatedAt'];
  const removeParts: string[] = [];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = {
    ':updatedAt': new Date().toISOString(),
  };

  if (updates.status !== undefined) {
    setParts.push('#status = :status', '#enabled = :enabled');
    names['#status'] = 'status';
    names['#enabled'] = 'enabled';
    values[':status'] = updates.status;
    values[':enabled'] = updates.status === 'active';
  }
  if (updates.consecutiveFailures !== undefined) {
    setParts.push('#consecutiveFailures = :consecutiveFailures');
    names['#consecutiveFailures'] = 'consecutiveFailures';
    values[':consecutiveFailures'] = updates.consecutiveFailures;
  }
  if (updates.lastError === null) {
    removeParts.push('#lastError');
    names['#lastError'] = 'lastError';
  } else if (updates.lastError !== undefined) {
    setParts.push('#lastError = :lastError');
    names['#lastError'] = 'lastError';
    values[':lastError'] = updates.lastError;
  }

  const clauses: string[] = [`SET ${setParts.join(', ')}`];
  if (removeParts.length > 0) {
    clauses.push(`REMOVE ${removeParts.join(', ')}`);
  }

  await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `scheduledTask#${userId}`,
        sk: taskId,
      },
      UpdateExpression: clauses.join(' '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
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
    errorCategory?: 'transient' | 'permanent';
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
  if (updates.errorCategory !== undefined) {
    expressionParts.push('#errorCategory = :errorCategory');
    expressionNames['#errorCategory'] = 'errorCategory';
    expressionValues[':errorCategory'] = updates.errorCategory;
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

// --- Cross-stack writers (step 5/6) ---------------------------------------
//
// The execute Lambda lives in its own construct/NestedStack and cannot import
// the main API's repository.ts. These helpers write to the parent-owned
// NotificationTable and main Chat table, which are granted to the execute
// Lambda via cross-stack grants. Item shapes mirror the main repository's
// createNotification / createMeeting-projection verbatim so the bell and the
// sidebar render identically regardless of the producer.

/**
 * Write a bell notification (sidebar) for a scheduler failure / auto-stop.
 * No-op (with a warning) when NOTIFICATION_TABLE_NAME is not configured, so a
 * misconfiguration never aborts the execution path.
 */
export const writeSchedNotification = async (
  userId: string,
  input: {
    type: SchedNotificationType;
    title: string;
    body?: string;
    link: string;
  }
): Promise<void> => {
  if (!NOTIFICATION_TABLE_NAME) {
    console.warn('NOTIFICATION_TABLE_NAME not set; skipping bell notification');
    return;
  }
  const createdDate = `${Date.now()}`;
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: NOTIFICATION_TABLE_NAME,
      Item: {
        id: `notification#${userId}`,
        createdDate,
        notificationId: `notification#${randomUUID()}`,
        type: input.type,
        title: input.title,
        ...(input.body !== undefined ? { body: input.body } : {}),
        link: input.link,
        read: false,
        ttl:
          Math.floor(Date.now() / 1000) + NOTIFICATION_TTL_DAYS * 24 * 60 * 60,
      },
    })
  );
};

/**
 * Project a finished execution into the main Chat table so it appears in the
 * sidebar history with usecase='sched'. Mirrors createMeeting's projection row
 * (id=`user#${userId}`, createdDate=epochMs SK). listChats returns all rows
 * unfiltered, so this row flows into the sidebar with no API change.
 * No-op (with a warning) when MAIN_TABLE_NAME is not configured.
 */
export const projectExecutionToChat = async (
  userId: string,
  input: {
    taskId: string;
    executionId: string;
    title: string;
    status: 'success' | 'error';
  }
): Promise<void> => {
  if (!MAIN_TABLE_NAME) {
    console.warn('MAIN_TABLE_NAME not set; skipping sched chat projection');
    return;
  }
  const createdDate = `${Date.now()}`;
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: MAIN_TABLE_NAME,
      Item: {
        id: `user#${userId}`,
        createdDate,
        chatId: `chat#${randomUUID()}`,
        usecase: 'sched',
        title: input.title,
        taskId: input.taskId,
        executionId: input.executionId,
        status: input.status,
        updatedDate: createdDate,
      },
    })
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
