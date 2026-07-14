import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { LicensePlan, UserLicense } from 'generative-ai-use-cases';

const LICENSE_TABLE_NAME = process.env.LICENSE_TABLE_NAME!;
const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

const PLANS_PK = 'plans';
const USAGE_TTL_SECONDS = 13 * 31 * 24 * 60 * 60; // ~13 months

// Current-month key (Asia/Tokyo based) YYYY-MM
export const currentMonthKey = (): string => {
  const jst = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
  );
  return `${jst.getFullYear()}-${`${jst.getMonth() + 1}`.padStart(2, '0')}`;
};

// Next reset date (1st of next month, Asia/Tokyo)
export const nextResetDate = (): string => {
  const jst = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
  );
  return new Date(jst.getFullYear(), jst.getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);
};

const toPlan = (item: Record<string, unknown>): LicensePlan => ({
  planId: item.planId as string,
  name: item.name as string,
  monthlyLimit: item.monthlyLimit as number,
  enabled: item.enabled as boolean,
  createdDate: item.createdDate as string,
  updatedDate: item.updatedDate as string,
});

export const listPlans = async (): Promise<LicensePlan[]> => {
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: LICENSE_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': PLANS_PK },
    })
  );
  return (res.Items ?? []).map(toPlan);
};

export const getPlan = async (planId: string): Promise<LicensePlan | null> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: PLANS_PK, sk: `plan#${planId}` },
    })
  );
  return res.Item ? toPlan(res.Item) : null;
};

export const putPlan = async (plan: LicensePlan): Promise<void> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: LICENSE_TABLE_NAME,
      Item: { pk: PLANS_PK, sk: `plan#${plan.planId}`, ...plan },
    })
  );
};

export const getAssignedPlanId = async (
  userId: string
): Promise<string | null> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: `user#${userId}`, sk: 'assignment' },
    })
  );
  return (res.Item?.planId as string | null | undefined) ?? null;
};

export const assignPlan = async (
  userId: string,
  planId: string | null,
  assignedBy: string
): Promise<void> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: LICENSE_TABLE_NAME,
      Item: {
        pk: `user#${userId}`,
        sk: 'assignment',
        planId,
        assignedBy,
        assignedDate: new Date().toISOString(),
      },
    })
  );
};

export const getUsageCount = async (userId: string): Promise<number> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: `user#${userId}`, sk: `usage#${currentMonthKey()}` },
    })
  );
  return (res.Item?.count as number | undefined) ?? 0;
};

export type EnforcementResult =
  | { allowed: true; unlimited: true }
  | { allowed: true; unlimited: false; count: number; limit: number }
  | { allowed: false; limit: number };

// Conditionally and atomically increment the current-month counter.
// Unassigned users and disabled plans are unlimited (design 6-C).
export const checkAndIncrementUsage = async (
  userId: string
): Promise<EnforcementResult> => {
  const planId = await getAssignedPlanId(userId);
  if (!planId) {
    return { allowed: true, unlimited: true };
  }

  const plan = await getPlan(planId);
  if (!plan || !plan.enabled) {
    // The assigned plan has been deleted or disabled: do not block the user's generation
    return { allowed: true, unlimited: true };
  }

  const sk = `usage#${currentMonthKey()}`;
  const ttl = Math.floor(Date.now() / 1000) + USAGE_TTL_SECONDS;

  try {
    const res = await dynamoDbDocument.send(
      new UpdateCommand({
        TableName: LICENSE_TABLE_NAME,
        Key: { pk: `user#${userId}`, sk },
        UpdateExpression:
          'SET #count = if_not_exists(#count, :zero) + :one, updatedDate = :now, #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':limit': plan.monthlyLimit,
          ':now': new Date().toISOString(),
          ':ttl': ttl,
        },
        ReturnValues: 'UPDATED_NEW',
      })
    );
    return {
      allowed: true,
      unlimited: false,
      count: (res.Attributes?.count as number) ?? 0,
      limit: plan.monthlyLimit,
    };
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { allowed: false, limit: plan.monthlyLimit };
    }
    throw e;
  }
};

export const getMyLicenseInfo = async (
  userId: string
): Promise<UserLicense> => {
  const planId = await getAssignedPlanId(userId);
  if (!planId) {
    return { planId: null, planName: null, usage: null };
  }
  const plan = await getPlan(planId);
  if (!plan) {
    return { planId: null, planName: null, usage: null };
  }
  const count = await getUsageCount(userId);
  return {
    planId: plan.planId,
    planName: plan.name,
    usage: {
      count,
      limit: plan.monthlyLimit,
      remaining: Math.max(plan.monthlyLimit - count, 0),
      resetDate: nextResetDate(),
    },
  };
};
