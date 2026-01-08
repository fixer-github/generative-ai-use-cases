import { ScheduledEvent } from 'aws-lambda';
import {
  SFNClient,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';
import {
  DynamoDBClient,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'default';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({});

interface Tenant {
  tenantId: string;
  status: string;
}

/**
 * Get yesterday's date in YYYY-MM-DD format (JST timezone)
 */
function getYesterdayDate(): string {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);
  jstNow.setDate(jstNow.getDate() - 1);
  return jstNow.toISOString().split('T')[0];
}

/**
 * List all active tenants from the Tenants table
 */
async function listActiveTenants(): Promise<string[]> {
  if (!TENANTS_TABLE_NAME) {
    console.log('No TENANTS_TABLE_NAME configured, using default tenant only');
    return [DEFAULT_TENANT_ID];
  }

  try {
    const tenantIds: string[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const response = await dynamoClient.send(
        new ScanCommand({
          TableName: TENANTS_TABLE_NAME,
          FilterExpression: '#status = :activeStatus',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':activeStatus': { S: 'active' },
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const tenant = unmarshall(item) as Tenant;
          tenantIds.push(tenant.tenantId);
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Always include default tenant if not already in the list
    if (!tenantIds.includes(DEFAULT_TENANT_ID)) {
      tenantIds.unshift(DEFAULT_TENANT_ID);
    }

    return tenantIds;
  } catch (error) {
    console.error('Failed to list tenants:', error);
    // Fallback to default tenant on error
    return [DEFAULT_TENANT_ID];
  }
}

/**
 * Start Step Functions execution for a single tenant
 */
async function startExecutionForTenant(
  tenantId: string,
  date: string
): Promise<{ tenantId: string; success: boolean; executionArn?: string; error?: string }> {
  try {
    const executionName = `summary-${tenantId}-${date}-${Date.now()}`;

    const response = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({
          tenantId,
          date,
          users: [], // Will be discovered by the Lambda
        }),
      })
    );

    console.log(`Started execution for tenant ${tenantId}: ${response.executionArn}`);
    return {
      tenantId,
      success: true,
      executionArn: response.executionArn,
    };
  } catch (error) {
    console.error(`Failed to start execution for tenant ${tenantId}:`, error);
    return {
      tenantId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Lambda handler for tenant discovery and Step Functions fan-out
 * Triggered by EventBridge on schedule
 */
export const handler = async (
  event: ScheduledEvent
): Promise<{
  statusCode: number;
  body: string;
}> => {
  console.log('Summary tenant discovery triggered:', JSON.stringify(event));

  try {
    const targetDate = getYesterdayDate();
    console.log(`Target date for summary generation: ${targetDate}`);

    // Discover all active tenants
    const tenantIds = await listActiveTenants();
    console.log(`Discovered ${tenantIds.length} tenants: ${tenantIds.join(', ')}`);

    if (tenantIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No tenants found',
          date: targetDate,
          total: 0,
        }),
      };
    }

    // Start executions for all tenants in parallel
    const results = await Promise.allSettled(
      tenantIds.map((tenantId) => startExecutionForTenant(tenantId, targetDate))
    );

    const summary = {
      date: targetDate,
      total: results.length,
      successful: results.filter(
        (r) => r.status === 'fulfilled' && r.value.success
      ).length,
      failed: results.filter(
        (r) =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && !r.value.success)
      ).length,
      executions: results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value),
    };

    console.log('Tenant discovery complete:', JSON.stringify(summary));

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    console.error('Tenant discovery failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
