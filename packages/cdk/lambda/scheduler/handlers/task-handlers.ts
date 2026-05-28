/**
 * Scheduled Task CRUD Handlers
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import * as crypto from 'crypto';
import {
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  ScheduledTask,
} from '../types';
import {
  createTask,
  getTask,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
} from '../repository';
import {
  toCronExpression,
  validateScheduleConfig,
} from '../utils/schedule-utils';
import { ensureUserNotificationTopic } from '../utils/notification-utils';
import {
  saveUserNotificationInfo,
  getUserNotificationInfo,
} from '../repository';
import { successResponse, errorResponse } from '../utils/response-utils';

const MAX_TASKS_PER_USER = 20;
const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION,
});

const EXECUTE_FUNCTION_ARN = process.env.EXECUTE_FUNCTION_ARN!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const DLQ_ARN = process.env.DLQ_ARN!;
const AGENT_NAME_TO_ARN_MAP: Record<string, string> = JSON.parse(
  process.env.AGENT_NAME_TO_ARN_MAP || '{}'
);

function validateAgentName(agentName: string): string | null {
  if (!AGENT_NAME_TO_ARN_MAP[agentName]) {
    const available = Object.keys(AGENT_NAME_TO_ARN_MAP).join(', ');
    return `Unknown agentName "${agentName}". Available agents: ${available}`;
  }
  return null;
}

export async function handleCreateTask(
  userId: string,
  body: CreateScheduledTaskRequest
): Promise<APIGatewayProxyResult> {
  // Validate request
  if (
    !body.taskName ||
    !body.prompt ||
    !body.agentName ||
    !body.modelId ||
    !body.schedule
  ) {
    return errorResponse(
      'taskName, prompt, agentName, modelId, schedule are required'
    );
  }

  const agentError = validateAgentName(body.agentName);
  if (agentError) return errorResponse(agentError);

  const scheduleError = validateScheduleConfig(body.schedule);
  if (scheduleError) return errorResponse(scheduleError);

  // Check task limit
  const currentCount = await countTasks(userId);
  if (currentCount >= MAX_TASKS_PER_USER) {
    return errorResponse(
      `Task limit reached (max ${MAX_TASKS_PER_USER} tasks per user)`,
      400,
      { code: 'TASK_LIMIT_REACHED', limit: MAX_TASKS_PER_USER }
    );
  }

  const taskId = crypto.randomUUID();
  const scheduleName = `gaixer-task-${taskId}`;
  const cronExpression = toCronExpression(body.schedule);

  // Ensure user has an SNS topic for notifications
  let snsTopicArn: string;
  try {
    const existingInfo = await getUserNotificationInfo(userId);
    if (existingInfo) {
      snsTopicArn = existingInfo.snsTopicArn;
    } else {
      const { topicArn, email } = await ensureUserNotificationTopic(userId);
      snsTopicArn = topicArn;
      await saveUserNotificationInfo(userId, { snsTopicArn: topicArn, email });
    }
  } catch (error) {
    console.error('Failed to setup SNS notification:', error);
    return errorResponse(
      'Failed to setup notification. Please try again.',
      500
    );
  }

  // Create EventBridge Schedule first (design principle: Scheduler before DB)
  try {
    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: cronExpression,
        ScheduleExpressionTimezone: 'Asia/Tokyo',
        Target: {
          Arn: EXECUTE_FUNCTION_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            taskId,
            userId,
            scheduledTime: '<aws.scheduler.scheduled-time>',
          }),
          DeadLetterConfig: {
            Arn: DLQ_ARN,
          },
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 3600,
          },
        },
        FlexibleTimeWindow: { Mode: 'OFF' },
        State: 'ENABLED',
      })
    );
  } catch (error) {
    console.error('Failed to create EventBridge schedule:', error);
    return errorResponse('Failed to create schedule. Please try again.', 500);
  }

  // Save task definition to DynamoDB
  const now = new Date().toISOString();
  const task: ScheduledTask = {
    pk: `scheduledTask#${userId}`,
    sk: taskId,
    taskId,
    taskName: body.taskName,
    prompt: body.prompt,
    agentName: body.agentName,
    modelId: body.modelId,
    schedule: body.schedule,
    eventBridgeScheduleName: scheduleName,
    enabled: true,
    deleted: false,
    userId,
    snsTopicArn,
    updatedAt: now,
  };

  try {
    const taskResponse = await createTask(task);
    return successResponse({ task: taskResponse }, 201);
  } catch (error) {
    // Rollback: delete the EventBridge schedule
    console.error('Failed to save task, rolling back schedule:', error);
    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({ Name: scheduleName })
      );
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }
    return errorResponse('Failed to create task. Please try again.', 500);
  }
}

export async function handleListTasks(
  userId: string
): Promise<APIGatewayProxyResult> {
  const tasks = await listTasks(userId);
  return successResponse({ tasks });
}

export async function handleGetTask(
  userId: string,
  taskId: string
): Promise<APIGatewayProxyResult> {
  const task = await getTask(userId, taskId);
  if (!task) {
    return errorResponse('Task not found', 404);
  }
  return successResponse({
    task: {
      taskId: task.taskId,
      taskName: task.taskName,
      prompt: task.prompt,
      agentName: task.agentName,
      modelId: task.modelId,
      schedule: task.schedule,
      enabled: task.enabled,
      updatedAt: task.updatedAt,
    },
  });
}

export async function handleUpdateTask(
  userId: string,
  taskId: string,
  body: UpdateScheduledTaskRequest
): Promise<APIGatewayProxyResult> {
  const existingTask = await getTask(userId, taskId);
  if (!existingTask) {
    return errorResponse('Task not found', 404);
  }

  if (body.agentName !== undefined) {
    const agentError = validateAgentName(body.agentName);
    if (agentError) return errorResponse(agentError);
  }

  // Determine if schedule or enabled state changed (requires EventBridge update)
  const scheduleChanged = body.schedule !== undefined;
  const enabledChanged =
    body.enabled !== undefined && body.enabled !== existingTask.enabled;

  if (scheduleChanged && body.schedule) {
    const scheduleError = validateScheduleConfig(body.schedule);
    if (scheduleError) return errorResponse(scheduleError);
  }

  if (scheduleChanged || enabledChanged) {
    const newSchedule = body.schedule || existingTask.schedule;
    const newEnabled =
      body.enabled !== undefined ? body.enabled : existingTask.enabled;
    const cronExpression = toCronExpression(newSchedule);

    try {
      await schedulerClient.send(
        new UpdateScheduleCommand({
          Name: existingTask.eventBridgeScheduleName,
          ScheduleExpression: cronExpression,
          ScheduleExpressionTimezone: 'Asia/Tokyo',
          Target: {
            Arn: EXECUTE_FUNCTION_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({
              taskId,
              userId,
              scheduledTime: '<aws.scheduler.scheduled-time>',
            }),
            DeadLetterConfig: {
              Arn: DLQ_ARN,
            },
            RetryPolicy: {
              MaximumRetryAttempts: 2,
              MaximumEventAgeInSeconds: 3600,
            },
          },
          FlexibleTimeWindow: { Mode: 'OFF' },
          State: newEnabled ? 'ENABLED' : 'DISABLED',
        })
      );
    } catch (error) {
      console.error('Failed to update EventBridge schedule:', error);
      return errorResponse('Failed to update schedule. Please try again.', 500);
    }
  }

  // Build update object (only include defined fields)
  const updates: Record<string, unknown> = {};
  if (body.taskName !== undefined) updates.taskName = body.taskName;
  if (body.prompt !== undefined) updates.prompt = body.prompt;
  if (body.agentName !== undefined) updates.agentName = body.agentName;
  if (body.modelId !== undefined) updates.modelId = body.modelId;
  if (body.schedule !== undefined) updates.schedule = body.schedule;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const taskResponse = await updateTask(userId, taskId, updates);
  return successResponse({ task: taskResponse });
}

export async function handleDeleteTask(
  userId: string,
  taskId: string
): Promise<APIGatewayProxyResult> {
  const existingTask = await getTask(userId, taskId);
  if (!existingTask) {
    return errorResponse('Task not found', 404);
  }

  // Delete EventBridge schedule first
  try {
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: existingTask.eventBridgeScheduleName,
      })
    );
  } catch (error) {
    console.error('Failed to delete EventBridge schedule:', error);
    return errorResponse('Failed to delete schedule. Please try again.', 500);
  }

  // Logical delete in DynamoDB
  await deleteTask(userId, taskId);
  return successResponse({ message: 'Task deleted' });
}
