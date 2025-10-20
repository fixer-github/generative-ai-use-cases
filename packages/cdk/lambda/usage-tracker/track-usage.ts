/**
 * Usage Tracker Lambda
 * 使用量追跡Lambda
 *
 * Processes usage events from EventBridge and updates DynamoDB counters.
 * Sends alerts when quotas are exceeded.
 */

import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const cloudwatch = new CloudWatchClient({});

const {
  DYNAMODB_PLAN_TABLE,
  DYNAMODB_USAGE_TABLE,
  QUOTA_ALERT_TOPIC_ARN,
  ENABLE_QUOTA_ALERTS = 'true',
} = process.env;

// Usage Event from EventBridge
interface UsageEvent {
  tenantId: string;
  userId: string;
  planId: string;
  resourceType: string;
  resourceId: string;
  model: string;
  timestamp: number;
  eventId?: string; // For idempotency
}

// Handler
export async function handler(
  event: EventBridgeEvent<'UsageEvent', UsageEvent>
): Promise<void> {
  console.log('Usage event received:', JSON.stringify(event, null, 2));

  const usageEvent = event.detail;
  const today = new Date(usageEvent.timestamp).toISOString().split('T')[0];

  try {
    // 1. Update DynamoDB counter (atomic increment)
    const updateResult = await updateUsageCounter(usageEvent, today);

    const currentCount = updateResult.Attributes?.count || 0;

    console.log(
      `Usage updated: ${usageEvent.tenantId} - ${usageEvent.model}: ${currentCount}`
    );

    // 2. Get quota limit
    const quotaLimit = await getQuotaLimit(usageEvent.planId, usageEvent.model);

    // 3. Check for quota alerts
    if (ENABLE_QUOTA_ALERTS === 'true') {
      await checkQuotaAlerts(
        usageEvent.tenantId,
        usageEvent.model,
        currentCount,
        quotaLimit
      );
    }

    // 4. Record metrics
    await recordUsageMetrics(usageEvent, currentCount, quotaLimit);
  } catch (error) {
    console.error('Failed to track usage:', error);
    throw error;
  }
}

// Update usage counter in DynamoDB
async function updateUsageCounter(
  usageEvent: UsageEvent,
  date: string
): Promise<any> {
  // Calculate TTL: 90 days from the usage date
  const usageDate = new Date(date);
  usageDate.setDate(usageDate.getDate() + 90);
  const ttl = Math.floor(usageDate.getTime() / 1000); // Unix timestamp in seconds

  const updateParams = {
    TableName: DYNAMODB_USAGE_TABLE,
    Key: {
      pk: `${usageEvent.tenantId}#${usageEvent.resourceType}`,
      sk: `${date}#${usageEvent.model}`,
    },
    UpdateExpression:
      'ADD #count :inc SET #tenantId = :tenantId, #userId = :userId, #planId = :planId, #model = :model, #date = :date, #lastUpdate = :timestamp, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#count': 'count',
      '#tenantId': 'tenant_id',
      '#userId': 'last_user_id',
      '#planId': 'plan_id',
      '#model': 'model',
      '#date': 'date',
      '#lastUpdate': 'last_update',
      '#ttl': 'ttl',
    },
    ExpressionAttributeValues: {
      ':inc': 1,
      ':tenantId': usageEvent.tenantId,
      ':userId': usageEvent.userId,
      ':planId': usageEvent.planId,
      ':model': usageEvent.model,
      ':date': date,
      ':timestamp': usageEvent.timestamp,
      ':ttl': ttl,
    },
    ReturnValues: 'ALL_NEW' as const,
  };

  // Add idempotency check if eventId is provided
  if (usageEvent.eventId) {
    updateParams.ExpressionAttributeNames['#eventId'] = 'last_event_id';
    updateParams.ExpressionAttributeValues[':eventId'] = usageEvent.eventId;
    (updateParams as any).ConditionExpression =
      'attribute_not_exists(last_event_id) OR last_event_id <> :eventId';
    updateParams.UpdateExpression += ', #eventId = :eventId';
  }

  try {
    return await dynamoDB.send(new UpdateCommand(updateParams));
  } catch (error: any) {
    // Ignore conditional check failures (duplicate event)
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('Duplicate event detected, skipping:', usageEvent.eventId);
      return { Attributes: { count: 0 } }; // Return dummy to avoid downstream errors
    }
    throw error;
  }
}

// Get quota limit from plan
async function getQuotaLimit(planId: string, model: string): Promise<number> {
  const result = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_PLAN_TABLE,
      Key: { plan_id: planId },
    })
  );

  if (!result.Item) {
    console.warn(`Plan ${planId} not found, using default quota`);
    return 10; // Default quota
  }

  const modelConfig =
    result.Item.features?.models?.[model] ||
    result.Item.permissions?.models?.[model];

  if (!modelConfig) {
    console.warn(
      `Model ${model} not found in plan ${planId}, using default quota`
    );
    return 10;
  }

  return modelConfig.daily_quota || 10;
}

// Check quota alerts
async function checkQuotaAlerts(
  tenantId: string,
  model: string,
  currentCount: number,
  quotaLimit: number
): Promise<void> {
  const utilization = (currentCount / quotaLimit) * 100;

  // 100% - Quota exceeded
  if (currentCount >= quotaLimit) {
    await sendQuotaAlert({
      tenantId,
      model,
      currentCount,
      quotaLimit,
      severity: 'critical',
      message: `Quota exceeded for ${model}`,
    });
  }
  // 90% - High utilization warning
  else if (utilization >= 90) {
    await sendQuotaAlert({
      tenantId,
      model,
      currentCount,
      quotaLimit,
      severity: 'high',
      message: `Quota at ${utilization.toFixed(0)}% for ${model}`,
    });
  }
  // 75% - Medium utilization warning
  else if (utilization >= 75) {
    await sendQuotaAlert({
      tenantId,
      model,
      currentCount,
      quotaLimit,
      severity: 'medium',
      message: `Quota at ${utilization.toFixed(0)}% for ${model}`,
    });
  }
}

// Send quota alert to SNS
interface QuotaAlert {
  tenantId: string;
  model: string;
  currentCount: number;
  quotaLimit: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

async function sendQuotaAlert(alert: QuotaAlert): Promise<void> {
  if (!QUOTA_ALERT_TOPIC_ARN) {
    console.log('No alert topic configured, skipping alert');
    return;
  }

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: QUOTA_ALERT_TOPIC_ARN,
        Subject: `[${alert.severity.toUpperCase()}] Quota Alert - ${alert.tenantId}`,
        Message: JSON.stringify(
          {
            ...alert,
            utilization: (alert.currentCount / alert.quotaLimit) * 100,
            timestamp: Date.now(),
          },
          null,
          2
        ),
        MessageAttributes: {
          severity: {
            DataType: 'String',
            StringValue: alert.severity,
          },
          tenant_id: {
            DataType: 'String',
            StringValue: alert.tenantId,
          },
          model: {
            DataType: 'String',
            StringValue: alert.model,
          },
        },
      })
    );

    console.log(`Quota alert sent: ${alert.severity} - ${alert.message}`);
  } catch (error) {
    console.error('Failed to send quota alert:', error);
  }
}

// Record usage metrics to CloudWatch
async function recordUsageMetrics(
  usageEvent: UsageEvent,
  currentCount: number,
  quotaLimit: number
): Promise<void> {
  const utilization = (currentCount / quotaLimit) * 100;

  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: 'Authorization/Usage',
        MetricData: [
          {
            MetricName: 'UsageEventProcessed',
            Value: 1,
            Unit: 'Count',
            Dimensions: [
              { Name: 'TenantId', Value: usageEvent.tenantId },
              { Name: 'Model', Value: usageEvent.model },
              { Name: 'ResourceType', Value: usageEvent.resourceType },
            ],
          },
          {
            MetricName: 'QuotaUtilization',
            Value: utilization,
            Unit: 'Percent',
            Dimensions: [
              { Name: 'TenantId', Value: usageEvent.tenantId },
              { Name: 'Model', Value: usageEvent.model },
              { Name: 'PlanId', Value: usageEvent.planId },
            ],
          },
          {
            MetricName: 'CurrentUsage',
            Value: currentCount,
            Unit: 'Count',
            Dimensions: [
              { Name: 'TenantId', Value: usageEvent.tenantId },
              { Name: 'Model', Value: usageEvent.model },
            ],
          },
        ],
      })
    );
  } catch (error) {
    console.error('Failed to record metrics:', error);
  }
}
