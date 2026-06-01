/**
 * Execute Scheduled Task Lambda
 *
 * Triggered by EventBridge Scheduler. Executes an AgentCore agent
 * with the task's prompt, saves the result, and sends notification.
 *
 * Flow:
 * 1. Receive { taskId, userId, scheduledTime } from EventBridge
 * 2. Get task definition from DynamoDB
 * 3. Check if task is enabled and not deleted (safety valve)
 * 4. Create execution log with idempotency check
 * 5. Invoke AgentCore runtime
 * 6. Buffer stream response
 * 7. Save result to DynamoDB
 * 8. Send email notification via SendGrid
 */

import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { SchedulerEventPayload, TaskExecution } from './scheduler/types';
import {
  getTask,
  createExecution,
  updateExecutionStatus,
} from './scheduler/repository';
import { collectStreamResponse } from './scheduler/utils/stream-utils';
import {
  sendSuccessNotification,
  sendErrorNotification,
  getUserEmail,
  isNotificationConfigured,
} from './scheduler/utils/notification-utils';

const MODEL_REGION = process.env.MODEL_REGION || 'us-east-1';
const AGENT_NAME_TO_ARN_MAP: Record<string, string> = JSON.parse(
  process.env.AGENT_NAME_TO_ARN_MAP || '{}'
);

const agentCoreClient = new BedrockAgentCoreClient({
  region: process.env.AGENT_CORE_REGION || process.env.AWS_REGION,
});

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

export const handler = async (event: SchedulerEventPayload): Promise<void> => {
  const { taskId, userId, scheduledTime } = event;
  console.log(
    `Executing scheduled task: taskId=${taskId}, userId=${userId}, scheduledTime=${scheduledTime}`
  );

  // 1. Get task definition
  const task = await getTask(userId, taskId);
  if (!task) {
    console.log(
      `Task ${taskId} not found, disabled, or deleted. Skipping execution.`
    );
    return;
  }

  if (!task.enabled || task.deleted) {
    console.log(`Task ${taskId} is disabled or deleted. Skipping execution.`);
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

  // 4. Create execution log with idempotency check
  const execution: TaskExecution = {
    pk: `taskExecution#${taskId}`,
    sk: executionId,
    executionId,
    taskId,
    userId,
    status: 'running',
    resultText: '',
    emailSent: false,
    startedAt: now,
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
  if (isNotificationConfigured()) {
    try {
      recipientEmail = await getUserEmail(userId);
    } catch (error) {
      console.error('Failed to resolve recipient email:', error);
    }
  }

  // 6. Invoke AgentCore with retry
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

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const command = new InvokeAgentRuntimeCommand(commandInput);
        response = await agentCoreClient.send(command);
        break;
      } catch (error) {
        lastError = error as Error;
        const isRetryable =
          lastError.name === 'ServiceException' ||
          lastError.name === 'ThrottlingException' ||
          lastError.name === 'ServiceUnavailableException' ||
          lastError.name === 'InternalServerException' ||
          (lastError.message && lastError.message.includes('5'));

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw lastError;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `Retry attempt ${attempt + 1}/${MAX_RETRIES} after ${delay}ms: ${lastError.message}`
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

    // 9. Send success notification
    let emailSent = false;
    if (recipientEmail) {
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
    const completedAt = new Date().toISOString();
    console.error(`Task ${taskId} execution failed:`, error);

    // Save error result
    try {
      await updateExecutionStatus(taskId, executionId, {
        status: 'error',
        errorMessage,
        completedAt,
      });
    } catch (dbError) {
      console.error(
        'CRITICAL: Failed to save error result to DynamoDB:',
        dbError
      );
      console.log('Error message (backup):', errorMessage);
    }

    // Send error notification
    if (recipientEmail) {
      try {
        await sendErrorNotification(
          recipientEmail,
          task.taskName,
          errorMessage,
          now
        );
        // Update emailSent
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
};
