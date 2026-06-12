/**
 * Execute Scheduled Task Lambda
 *
 * Triggered by EventBridge Scheduler (recurring cron fire, a one-time retry
 * schedule, or a manual "run now" async invoke). Executes an AgentCore agent
 * with the task's prompt, saves the result, drives the failure/retry lifecycle,
 * and projects the run into the sidebar history.
 *
 * Failure lifecycle (step 5 / decision A — single source of retry truth):
 * - The handler swallows task errors (never re-throws), so EventBridge's own
 *   RetryPolicy is intentionally disabled (MaximumRetryAttempts: 0). Retries are
 *   driven here by self-rescheduling one-time `at()` schedules at 30s / 2m / 8m.
 * - Each fire is one TaskExecution row (distinct executionId via scheduledTime),
 *   so the retry timeline maps 1:1 to data.
 * - A permanent error stops immediately; a transient error retries up to 3 times
 *   and then auto-stops. Auto-stop sets status='error', disables the recurring
 *   schedule, writes a bell notification and (only at this terminal point) emails.
 * - Manual runs ("run now") execute once and are surfaced in history, but do not
 *   touch the failure counter, schedule retries, auto-stop, or email.
 */

import { Context } from 'aws-lambda';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import {
  SchedulerClient,
  CreateScheduleCommand,
  GetScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  SchedulerEventPayload,
  TaskExecution,
  ScheduledTask,
  ExecutionTrigger,
  ErrorCategory,
} from './scheduler/types';
import {
  getTask,
  createExecution,
  updateExecutionStatus,
  updateTaskRuntime,
  writeSchedNotification,
  projectExecutionToChat,
} from './scheduler/repository';
import { collectStreamResponse } from './scheduler/utils/stream-utils';
import {
  sendSuccessNotification,
  sendErrorNotification,
  getUserEmail,
  buildSchedFailedNotification,
  buildSchedPausedNotification,
} from './scheduler/utils/notification-utils';
import { toOneTimeExpression } from './scheduler/utils/schedule-utils';
import { isSendGridConfigured } from './utils/sendgrid';

const MODEL_REGION = process.env.MODEL_REGION || 'us-east-1';
const AGENT_NAME_TO_ARN_MAP: Record<string, string> = JSON.parse(
  process.env.AGENT_NAME_TO_ARN_MAP || '{}'
);
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;
const DLQ_ARN = process.env.DLQ_ARN;

const agentCoreClient = new BedrockAgentCoreClient({
  region: process.env.AGENT_CORE_REGION || process.env.AWS_REGION,
});
const schedulerClient = new SchedulerClient({ region: process.env.AWS_REGION });

// In-Lambda transient absorption for a single attempt (throttling, 5xx). This is
// invisible to the user-facing retry timeline (which counts whole fires).
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

// User-facing retry schedule (decision A / proto): up to 3 self-rescheduled
// one-time retries at these delays, then auto-stop.
const RETRY_DELAYS_SEC = [30, 120, 480]; // 30s, 2m, 8m
const MAX_TASK_RETRIES = RETRY_DELAYS_SEC.length;

/**
 * Classify an AgentCore error as transient (retryable) or permanent. Mirrors the
 * in-attempt isRetryable heuristic: AWS throttling / 5xx are transient.
 */
function classifyError(error: unknown): ErrorCategory {
  const err = error as { name?: string; message?: string };
  const transient =
    err?.name === 'ServiceException' ||
    err?.name === 'ThrottlingException' ||
    err?.name === 'ServiceUnavailableException' ||
    err?.name === 'InternalServerException' ||
    (!!err?.message && err.message.includes('5'));
  return transient ? 'transient' : 'permanent';
}

/**
 * The function's own ARN, read from the invocation context (avoids the CDK
 * self-reference cycle that an EXECUTE_FUNCTION_ARN env var on this function
 * would create). Any trailing version/alias qualifier is stripped so the ARN
 * matches the schedulerExecutionRole's invoke grant.
 */
function ownFunctionArn(context: Context): string {
  const parts = context.invokedFunctionArn.split(':');
  return parts.length > 7
    ? parts.slice(0, 7).join(':')
    : context.invokedFunctionArn;
}

/**
 * Schedule the next transient retry as a one-time `at()` schedule that deletes
 * itself after firing (ActionAfterCompletion: DELETE). `failureCount` is the
 * current consecutive-failure count (1-based): retry-1 fires after 30s, etc.
 */
async function scheduleRetry(
  ownArn: string,
  taskId: string,
  userId: string,
  failureCount: number
): Promise<void> {
  const delaySec = RETRY_DELAYS_SEC[failureCount - 1];
  const fireAt = new Date(Date.now() + delaySec * 1000);
  const name = `gaixer-task-${taskId}-retry-${failureCount}`;
  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: name,
      ScheduleExpression: toOneTimeExpression(fireAt),
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      State: 'ENABLED',
      Target: {
        Arn: ownArn,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          taskId,
          userId,
          scheduledTime: '<aws.scheduler.scheduled-time>',
          trigger: 'retry',
        }),
        ...(DLQ_ARN ? { DeadLetterConfig: { Arn: DLQ_ARN } } : {}),
        RetryPolicy: { MaximumRetryAttempts: 0 },
      },
    })
  );
}

/**
 * Disable the recurring schedule on auto-stop. EventBridge UpdateSchedule is a
 * full replace, so we read the current schedule and write it back with
 * State='DISABLED'. Best-effort: the DynamoDB status='error' + derived
 * enabled=false (which the handler guard also honours) is the source of truth,
 * so a failure here only leaves the schedule firing into a no-op guard.
 */
async function disableRecurringSchedule(scheduleName: string): Promise<void> {
  try {
    const got = await schedulerClient.send(
      new GetScheduleCommand({ Name: scheduleName })
    );
    await schedulerClient.send(
      new UpdateScheduleCommand({
        Name: scheduleName,
        GroupName: got.GroupName,
        ScheduleExpression: got.ScheduleExpression,
        ScheduleExpressionTimezone: got.ScheduleExpressionTimezone,
        FlexibleTimeWindow: got.FlexibleTimeWindow,
        Target: got.Target,
        State: 'DISABLED',
      })
    );
  } catch (error) {
    console.error(
      `Failed to disable recurring schedule ${scheduleName}:`,
      error
    );
  }
}

/**
 * Drive the failure lifecycle for a failed (non-manual) execution: bump the
 * counter, schedule a retry while transient retries remain, otherwise auto-stop
 * (status='error', disable schedule, bell notification + terminal email) and
 * project the terminal outcome into history.
 */
async function handleScheduledFailure(params: {
  task: ScheduledTask;
  userId: string;
  taskId: string;
  executionId: string;
  errorMessage: string;
  category: ErrorCategory;
  completedAt: string;
  startedAt: string;
  recipientEmail?: string;
  ownArn: string;
}): Promise<void> {
  const {
    task,
    userId,
    taskId,
    executionId,
    errorMessage,
    category,
    completedAt,
    startedAt,
    recipientEmail,
    ownArn,
  } = params;

  const cf = (task.consecutiveFailures ?? 0) + 1;
  const lastError = { category, message: errorMessage, at: completedAt };

  // Transient with retries remaining: keep the task active, schedule the retry.
  if (category === 'transient' && cf <= MAX_TASK_RETRIES) {
    try {
      await updateTaskRuntime(userId, taskId, {
        consecutiveFailures: cf,
        lastError,
      });
    } catch (error) {
      console.error('Failed to persist consecutive-failure counter:', error);
    }
    try {
      await scheduleRetry(ownArn, taskId, userId, cf);
      console.log(
        `Scheduled transient retry ${cf}/${MAX_TASK_RETRIES} for task ${taskId} in ${RETRY_DELAYS_SEC[cf - 1]}s`
      );
      return; // not terminal: no notification / email / projection yet
    } catch (error) {
      console.error(
        `Failed to schedule retry for task ${taskId}; auto-stopping instead:`,
        error
      );
      // fall through to terminal handling so the failure is never silently lost
    }
  }

  // Terminal: permanent error, or transient retries exhausted (or unschedulable).
  try {
    await updateTaskRuntime(userId, taskId, {
      status: 'error',
      consecutiveFailures: cf,
      lastError,
    });
  } catch (error) {
    console.error('Failed to persist auto-stop status:', error);
  }

  await disableRecurringSchedule(task.eventBridgeScheduleName);

  const notif =
    category === 'permanent'
      ? buildSchedFailedNotification(task.taskName, errorMessage)
      : buildSchedPausedNotification(task.taskName);
  try {
    await writeSchedNotification(userId, {
      type: category === 'permanent' ? 'sched_failed' : 'sched_paused',
      title: notif.title,
      body: notif.body,
      link: `/g/scheduler/${taskId}`,
    });
  } catch (error) {
    console.error('Failed to write bell notification:', error);
  }

  try {
    await projectExecutionToChat(userId, {
      taskId,
      executionId,
      title: task.taskName,
      status: 'error',
    });
  } catch (error) {
    console.error('Failed to project failed execution to chat:', error);
  }

  // Terminal email only (transient retries do not email — avoids flooding).
  if (recipientEmail) {
    try {
      await sendErrorNotification(
        recipientEmail,
        task.taskName,
        errorMessage,
        startedAt
      );
      try {
        await updateExecutionStatus(taskId, executionId, {
          status: 'error',
          emailSent: true,
          completedAt,
        });
      } catch {
        // Best effort
      }
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError);
    }
  }
}

export const handler = async (
  event: SchedulerEventPayload,
  context: Context
): Promise<void> => {
  const { taskId, userId, scheduledTime } = event;
  const trigger: ExecutionTrigger = event.trigger ?? 'schedule';
  const isManual = trigger === 'manual';
  console.log(
    `Executing scheduled task: taskId=${taskId}, userId=${userId}, scheduledTime=${scheduledTime}, trigger=${trigger}`
  );

  // 1. Get task definition
  const task = await getTask(userId, taskId);
  if (!task) {
    console.log(
      `Task ${taskId} not found, disabled, or deleted. Skipping execution.`
    );
    return;
  }

  // Scheduled/retry fires honour the enabled guard (a paused/auto-stopped task
  // must not run). Manual "run now" bypasses it (the user explicitly asked).
  if (!isManual && !task.enabled) {
    console.log(`Task ${taskId} is disabled. Skipping execution.`);
    return;
  }

  // 2. Resolve agent ARN
  const agentRuntimeArn = AGENT_NAME_TO_ARN_MAP[task.agentName];
  if (!agentRuntimeArn) {
    console.error(
      `Unknown agentName "${task.agentName}" for task ${taskId}. Skipping.`
    );
    return;
  }

  // 3. Generate deterministic executionId for idempotency
  const executionId = `${taskId}#${scheduledTime}`;
  const now = new Date().toISOString();
  // Attempt position within the current consecutive-failure streak (timeline UI).
  const attempt = isManual ? undefined : (task.consecutiveFailures ?? 0) + 1;

  // 4. Create execution log with idempotency check
  const execution = {
    pk: `taskExecution#${taskId}`,
    sk: executionId,
    executionId,
    taskId,
    userId,
    status: 'running',
    resultText: '',
    emailSent: false,
    startedAt: now,
    trigger,
    ...(attempt !== undefined ? { attempt } : {}),
    // GSI attributes for calendar query
    gsiPk: `userExecution#${userId}`,
    gsiSk: now,
  } as TaskExecution & { gsiPk: string; gsiSk: string };

  const created = await createExecution(execution);
  if (!created) {
    console.log(
      `Execution ${executionId} already exists. Duplicate execution prevented.`
    );
    return;
  }

  // 5. Resolve recipient email (best-effort). Skipped when notifications are
  //    not configured (e.g. closed-network mode).
  let recipientEmail: string | undefined;
  if (isSendGridConfigured()) {
    try {
      recipientEmail = await getUserEmail(userId);
    } catch (error) {
      console.error('Failed to resolve recipient email:', error);
    }
  }

  // 6. Invoke AgentCore with in-attempt transient absorption
  try {
    const agentCoreRequest = {
      messages: [],
      system_prompt: '',
      prompt: [{ text: task.prompt }],
      model: {
        type: 'bedrock',
        modelId: task.modelId,
        region: MODEL_REGION,
      },
    };

    const commandInput = {
      agentRuntimeArn,
      qualifier: 'DEFAULT',
      payload: JSON.stringify(agentCoreRequest),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: any = null;
    let lastError: Error | null = null;

    for (let attemptIdx = 0; attemptIdx <= MAX_RETRIES; attemptIdx++) {
      try {
        const command = new InvokeAgentRuntimeCommand(commandInput);
        response = await agentCoreClient.send(command);
        break;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = classifyError(lastError) === 'transient';

        if (!isRetryable || attemptIdx === MAX_RETRIES) {
          throw lastError;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attemptIdx);
        console.log(
          `Retry attempt ${attemptIdx + 1}/${MAX_RETRIES} after ${delay}ms: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (!response) {
      throw lastError || new Error('No response from AgentCore');
    }

    // 7. Buffer stream response
    const streamResult = await collectStreamResponse(response);
    const completedAt = new Date().toISOString();

    // 8. Save success result
    try {
      await updateExecutionStatus(taskId, executionId, {
        status: 'success',
        resultText: streamResult.text,
        tokenUsage: streamResult.tokenUsage,
        completedAt,
      });
    } catch (dbError) {
      console.error(
        'CRITICAL: Failed to save execution result to DynamoDB:',
        dbError
      );
      console.log('Execution result (backup):', JSON.stringify(streamResult));
    }

    // 8b. Reset the failure streak / mark active (scheduled & retry runs only;
    //     manual runs never mutate lifecycle state).
    if (!isManual) {
      try {
        await updateTaskRuntime(userId, taskId, {
          status: 'active',
          consecutiveFailures: 0,
          lastError: null,
        });
      } catch (error) {
        console.error('Failed to reset task runtime state:', error);
      }
    }

    // 8c. Project the successful run into the sidebar history (usecase='sched').
    try {
      await projectExecutionToChat(userId, {
        taskId,
        executionId,
        title: task.taskName,
        status: 'success',
      });
    } catch (error) {
      console.error('Failed to project execution to chat:', error);
    }

    // 9. Send success notification (scheduled & retry only; manual is interactive)
    let emailSent = false;
    if (recipientEmail && !isManual) {
      try {
        await sendSuccessNotification(
          recipientEmail,
          task.taskName,
          streamResult.text,
          now,
          streamResult.tokenUsage
        );
        emailSent = true;
      } catch (notifyError) {
        console.error('Failed to send success notification:', notifyError);
      }
    }

    // 10. Update emailSent status
    try {
      await updateExecutionStatus(taskId, executionId, {
        status: 'success',
        emailSent,
        completedAt,
      });
    } catch (dbError) {
      console.error('Failed to update emailSent status:', dbError);
    }
  } catch (error) {
    // Handle execution failure
    const errorMessage = error instanceof Error ? error.message : String(error);
    const category = classifyError(error);
    const completedAt = new Date().toISOString();
    console.error(
      `Task ${taskId} execution failed (${category}, trigger=${trigger}):`,
      error
    );

    // Save error result with its classification.
    try {
      await updateExecutionStatus(taskId, executionId, {
        status: 'error',
        errorMessage,
        errorCategory: category,
        completedAt,
      });
    } catch (dbError) {
      console.error(
        'CRITICAL: Failed to save error result to DynamoDB:',
        dbError
      );
      console.log('Error message (backup):', errorMessage);
    }

    if (isManual) {
      // Manual runs surface their result in history but do not drive the
      // failure chain (no counter / retry / auto-stop / email).
      try {
        await projectExecutionToChat(userId, {
          taskId,
          executionId,
          title: task.taskName,
          status: 'error',
        });
      } catch (projError) {
        console.error('Failed to project manual failure to chat:', projError);
      }
      return;
    }

    await handleScheduledFailure({
      task,
      userId,
      taskId,
      executionId,
      errorMessage,
      category,
      completedAt,
      startedAt: now,
      recipientEmail,
      ownArn: ownFunctionArn(context),
    });
  }
};
