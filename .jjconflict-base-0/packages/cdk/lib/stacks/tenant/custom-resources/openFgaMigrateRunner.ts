/**
 * Custom Resource Lambda for running OpenFGA database migration
 * This is called during CloudFormation stack creation/update to run 'openfga migrate'
 * as a one-time Fargate task before starting the ECS service.
 *
 * Based on OpenFGA official recommendations:
 * - Separate migrate execution from application server (openfga run)
 * - Run migrate once before deploying the service
 * - Ensure idempotency for safe re-deployments
 */

import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from 'aws-lambda';
import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  Task,
  Container,
} from '@aws-sdk/client-ecs';

interface ResourceProperties {
  ClusterArn: string;
  TaskDefinitionArn: string;
  Subnets: string;
  SecurityGroups: string;
}

const ecs = new ECSClient({});

/**
 * Send CloudFormation response
 */
async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  reason: string,
  physicalResourceId: string,
  data?: Record<string, any>
): Promise<void> {
  const responseBody: CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: data || {},
  };

  console.log('Sending CloudFormation response:', responseBody);

  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': JSON.stringify(responseBody).length.toString(),
    },
    body: JSON.stringify(responseBody),
  });

  if (!response.ok) {
    console.error(
      'Failed to send CloudFormation response:',
      response.statusText
    );
  }
}

/**
 * Wait for task completion with polling
 * Returns true if task completed successfully, throws error otherwise
 */
async function waitForTaskCompletion(
  clusterArn: string,
  taskArn: string,
  maxPollingMinutes: number = 10
): Promise<void> {
  const maxAttempts = (maxPollingMinutes * 60) / 5; // Poll every 5 seconds
  let attempts = 0;

  console.log(
    `Waiting for task ${taskArn} to complete (max ${maxPollingMinutes} minutes)...`
  );

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

    const describeCommand = new DescribeTasksCommand({
      cluster: clusterArn,
      tasks: [taskArn],
    });

    const describeResult = await ecs.send(describeCommand);
    const task: Task | undefined = describeResult.tasks?.[0];

    if (!task) {
      throw new Error('Task not found in describe response');
    }

    console.log(
      `Task status: ${task.lastStatus} (attempt ${attempts + 1}/${maxAttempts})`
    );

    if (task.lastStatus === 'STOPPED') {
      const container: Container | undefined = task.containers?.[0];

      if (!container) {
        throw new Error('No container found in task');
      }

      console.log('Task stopped. Container details:', {
        exitCode: container.exitCode,
        reason: container.reason,
        name: container.name,
      });

      // Check exit code
      if (container.exitCode === 0) {
        console.log('Migration completed successfully');
        return;
      }

      // Check if migration was already applied (idempotency)
      // OpenFGA migrate uses goose, which can fail if migrations are already applied
      const reason = container.reason || '';
      const stoppedReason = task.stoppedReason || '';

      if (
        reason.includes('goose_db_version') ||
        reason.includes('already exists') ||
        stoppedReason.includes('goose_db_version') ||
        stoppedReason.includes('already exists')
      ) {
        console.warn(
          'Migration appears to be already applied. Treating as success for idempotency.'
        );
        return;
      }

      // Migration failed
      throw new Error(
        `Migration task failed with exit code ${container.exitCode}. ` +
          `Reason: ${reason || stoppedReason || 'Unknown'}. ` +
          `Check CloudWatch Logs for detailed error messages.`
      );
    }

    attempts++;
  }

  throw new Error(
    `Migration task did not complete within ${maxPollingMinutes} minutes. ` +
      `Task may still be running. Check ECS console and CloudWatch Logs.`
  );
}

/**
 * Run migration task
 */
async function runMigration(props: ResourceProperties): Promise<void> {
  const subnets = props.Subnets.split(',');
  const securityGroups = props.SecurityGroups.split(',');

  console.log('Starting migration task with configuration:', {
    cluster: props.ClusterArn,
    taskDefinition: props.TaskDefinitionArn,
    subnets,
    securityGroups,
  });

  // Run the migration task
  const runTaskCommand = new RunTaskCommand({
    cluster: props.ClusterArn,
    launchType: 'FARGATE',
    taskDefinition: props.TaskDefinitionArn,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets,
        securityGroups,
        assignPublicIp: 'DISABLED', // Assumes VPC has NAT Gateway or VPC Endpoints
      },
    },
    count: 1,
    platformVersion: 'LATEST',
  });

  const runResult = await ecs.send(runTaskCommand);

  if (!runResult.tasks || runResult.tasks.length === 0) {
    throw new Error(
      'Failed to start migration task. ' +
        `Failures: ${JSON.stringify(runResult.failures)}`
    );
  }

  const task = runResult.tasks[0];
  const taskArn = task.taskArn;

  if (!taskArn) {
    throw new Error('Task ARN not found in run task response');
  }

  console.log(`Migration task started: ${taskArn}`);

  // Wait for task to complete
  await waitForTaskCompletion(props.ClusterArn, taskArn);

  console.log('Migration task completed successfully');
}

/**
 * Lambda handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<void> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties as unknown as ResourceProperties;
  const physicalResourceId = 'openfga-migrate-runner';

  try {
    if (event.RequestType === 'Delete') {
      // For deletion, we don't need to do anything
      // The migration state is preserved in the database
      console.log('Delete request received. No action needed.');
      await sendResponse(
        event,
        'SUCCESS',
        'Delete completed successfully',
        physicalResourceId
      );
      return;
    }

    // For both Create and Update, run the migration
    // OpenFGA migrate is idempotent (uses goose migration tool)
    console.log(
      `${event.RequestType} request received. Running migration...`
    );

    await runMigration(props);

    await sendResponse(
      event,
      'SUCCESS',
      'Migration completed successfully',
      physicalResourceId,
      {
        MigrationStatus: 'Completed',
      }
    );
  } catch (error) {
    console.error('Error in migration runner:', error);

    await sendResponse(
      event,
      'FAILED',
      `Error: ${(error as Error).message}`,
      physicalResourceId
    );

    // Re-throw to ensure Lambda execution is marked as failed
    throw error;
  }
};
