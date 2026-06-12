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
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
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
  updateTaskRuntime,
  deleteTask,
  toTaskResponse,
} from '../repository';
import {
  toCronExpression,
  validateScheduleConfig,
} from '../utils/schedule-utils';
import { successResponse, errorResponse } from '../utils/response-utils';

// Per-user task limit. D7: aligned with the prototype's quota meter (was 20).
const MAX_TASKS_PER_USER = 10;
const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION,
});
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

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
          // Decision A: the execute Lambda is the single source of retry truth
          // (self-rescheduled one-time retries at 30s/2m/8m, recorded per fire).
          // EventBridge's own retry is disabled so it cannot fire untracked
          // re-runs (it also never fired for task errors, which are swallowed).
          RetryPolicy: {
            MaximumRetryAttempts: 0,
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
  // listTasks already returns non-deleted tasks, so its length is the live
  // count — no extra COUNT query needed for the quota meter (D7).
  const remaining = Math.max(0, MAX_TASKS_PER_USER - tasks.length);
  return successResponse({ tasks, remaining, limit: MAX_TASKS_PER_USER });
}

export async function handleGetTask(
  userId: string,
  taskId: string
): Promise<APIGatewayProxyResult> {
  const task = await getTask(userId, taskId);
  if (!task) {
    return errorResponse('Task not found', 404);
  }
  // toTaskResponse derives status/consecutiveFailures/lastError (step 5).
  return successResponse({ task: toTaskResponse(task) });
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
            // Decision A: EventBridge retry disabled (see handleCreateTask).
            RetryPolicy: {
              MaximumRetryAttempts: 0,
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

  // Content updates (everything except the enabled/status lifecycle).
  const contentUpdates: Record<string, unknown> = {};
  if (body.taskName !== undefined) contentUpdates.taskName = body.taskName;
  if (body.prompt !== undefined) contentUpdates.prompt = body.prompt;
  if (body.agentName !== undefined) contentUpdates.agentName = body.agentName;
  if (body.modelId !== undefined) contentUpdates.modelId = body.modelId;
  if (body.schedule !== undefined) contentUpdates.schedule = body.schedule;
  if (Object.keys(contentUpdates).length > 0) {
    await updateTask(userId, taskId, contentUpdates);
  }

  // `enabled` is the API surface for pause/resume; internally it maps to
  // `status` (the source of truth, which also re-derives `enabled`). Re-enabling
  // clears the failure streak + lastError so an auto-stopped task starts clean.
  if (enabledChanged) {
    await updateTaskRuntime(userId, taskId, {
      status: body.enabled ? 'active' : 'paused',
      ...(body.enabled ? { consecutiveFailures: 0, lastError: null } : {}),
    });
  }

  const finalTask = await getTask(userId, taskId);
  if (!finalTask) {
    return errorResponse('Task not found', 404);
  }
  return successResponse({ task: toTaskResponse(finalTask) });
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

/**
 * "Run now" (step 5). Fires the task once immediately by asynchronously invoking
 * the execute Lambda with trigger='manual'. A manual run records an execution
 * and projects its result into history, but does not drive the failure chain
 * (no counter / retry / auto-stop / email) — see executeScheduledTask.ts.
 *
 * Async invoke (InvocationType: 'Event') returns immediately, so a long task
 * never blocks the 30s API Lambda; the result surfaces via history + the bell.
 */
export async function handleRunNow(
  userId: string,
  taskId: string
): Promise<APIGatewayProxyResult> {
  const task = await getTask(userId, taskId);
  if (!task) {
    return errorResponse('Task not found', 404);
  }

  // ms precision keeps the executionId (taskId#scheduledTime) distinct from the
  // recurring fire's (rounded to the schedule's minute boundary).
  const payload = {
    taskId,
    userId,
    scheduledTime: new Date().toISOString(),
    trigger: 'manual',
  };

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: EXECUTE_FUNCTION_ARN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
  } catch (error) {
    console.error('Failed to trigger manual run:', error);
    return errorResponse('Failed to trigger run. Please try again.', 500);
  }

  return successResponse({ message: 'Task run triggered' }, 202);
}
