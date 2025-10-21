import type {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
  PolicyDocument,
  Statement,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import {
  checkUsecasePermission,
  checkModelPermission,
  checkResourcePermission,
  QuotaContext,
} from '../utils/openfgaClient';

// Environment variables
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const DYNAMODB_PLAN_TABLE = process.env.DYNAMODB_PLAN_TABLE!;
const DYNAMODB_USER_PLAN_TABLE = process.env.DYNAMODB_USER_PLAN_TABLE!;
const DYNAMODB_TENANT_PLAN_TABLE = process.env.DYNAMODB_TENANT_PLAN_TABLE!;
const DYNAMODB_USAGE_TABLE = process.env.DYNAMODB_USAGE_TABLE!;
const DYNAMODB_USER_QUOTA_TABLE = process.env.DYNAMODB_USER_QUOTA_TABLE!;

// Clients
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudwatchClient = new CloudWatchClient({});

// JWT Verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: COGNITO_USER_POOL_ID,
  tokenUse: 'access',
  clientId: COGNITO_CLIENT_ID,
});

/**
 * Extract tenant ID from custom claims
 */
function extractTenantId(token: any): string {
  return token['custom:tenant_id'] || token.tenant_id;
}

/**
 * Extract user ID from token
 */
function extractUserId(token: any): string {
  return token.sub || token['cognito:username'];
}

/**
 * Get tenant plan information from DynamoDB
 */
async function getTenantPlan(tenantId: string) {
  const response = await dynamoClient.send(
    new GetCommand({
      TableName: DYNAMODB_TENANT_PLAN_TABLE,
      Key: { tenant_id: tenantId },
    })
  );

  return response.Item;
}

/**
 * Get plan details from DynamoDB
 */
async function getPlanDetails(planId: string) {
  const response = await dynamoClient.send(
    new GetCommand({
      TableName: DYNAMODB_PLAN_TABLE,
      Key: { plan_id: planId },
    })
  );

  return response.Item;
}

/**
 * Get user's individual quota limit
 */
async function getUserQuotaLimit(userId: string, tenantId: string, modelId: string): Promise<number | null> {
  try {
    const response = await dynamoClient.send(
      new GetCommand({
        TableName: DYNAMODB_USER_QUOTA_TABLE,
        Key: {
          user_id: userId,
          tenant_model: `${tenantId}#${modelId}`,
        },
      })
    );

    return response.Item?.daily_limit || null;
  } catch (error) {
    console.error('Error fetching user quota:', error);
    return null;
  }
}

/**
 * Get user's current usage for quota checking
 */
async function getUserCurrentUsage(userId: string, modelId: string, date: string): Promise<number> {
  try {
    const response = await dynamoClient.send(
      new GetCommand({
        TableName: DYNAMODB_USAGE_TABLE,
        Key: {
          user_id_resource: `${userId}#model`,
          date_model: `${date}#${modelId}`,
        },
      })
    );

    return response.Item?.count || 0;
  } catch (error) {
    console.error('Error fetching user usage:', error);
    return 0;
  }
}

/**
 * Get tenant's current usage for quota checking
 */
async function getTenantCurrentUsage(tenantId: string, modelId: string, date: string): Promise<number> {
  try {
    const response = await dynamoClient.send(
      new GetCommand({
        TableName: DYNAMODB_USAGE_TABLE,
        Key: {
          tenant_id_resource: `${tenantId}#model`,
          date_model: `${date}#${modelId}`,
        },
      })
    );

    return response.Item?.count || 0;
  } catch (error) {
    console.error('Error fetching tenant usage:', error);
    return 0;
  }
}

/**
 * Map HTTP method and resource to OpenFGA permission
 */
function mapMethodToPermission(method: string, resourceType: string, resourceId: string): string {
  // Special case: creating new resources
  if (resourceId === 'new') {
    if (resourceType === 'document') return 'upload';
    if (resourceType === 'conversation') return 'view'; // tenant membership check
  }

  switch (method) {
    case 'GET':
    case 'HEAD':
      return 'view';
    case 'POST':
      if (resourceType === 'document') return 'upload';
      return 'view'; // For conversations, POST checks tenant membership
    case 'PUT':
    case 'PATCH':
      return 'edit';
    case 'DELETE':
      return 'delete';
    default:
      return 'view';
  }
}

/**
 * Parse API path to extract resource and action information
 */
function parseApiPath(path: string, method: string): {
  category: 'usecase' | 'model' | 'resource';
  resourceType?: string;
  resourceId?: string;
  permission?: string;
} {
  const pathParts = path.split('/').filter(Boolean);

  // Example patterns:
  // /api/execute/chat -> usecase execution
  // /api/execute/model/claude-sonnet -> model execution
  // /api/conversations/123 -> resource access
  // /api/documents/new -> resource creation

  if (pathParts[1] === 'execute') {
    if (pathParts[2] === 'model' && pathParts[3]) {
      // Model execution: /api/execute/model/claude-sonnet
      return {
        category: 'model',
        resourceId: pathParts[3],
      };
    } else if (pathParts[2]) {
      // Usecase execution: /api/execute/chat
      return {
        category: 'usecase',
        resourceId: pathParts[2],
      };
    }
  }

  // Resource access patterns
  const resourceType = pathParts[1]?.replace(/s$/, ''); // Remove plural 's'
  const resourceId = pathParts[2] || 'new';

  let permission: 'view' | 'edit' | 'delete' | 'upload' = 'view';

  if (resourceType === 'document' && resourceId === 'new') {
    permission = 'upload';
  } else {
    switch (method) {
      case 'GET':
      case 'HEAD':
        permission = 'view';
        break;
      case 'POST':
        permission = resourceType === 'document' ? 'upload' : 'view';
        break;
      case 'PUT':
      case 'PATCH':
        permission = 'edit';
        break;
      case 'DELETE':
        permission = 'delete';
        break;
    }
  }

  return {
    category: 'resource',
    resourceType,
    resourceId,
    permission,
  };
}

/**
 * Send CloudWatch metric
 */
async function sendMetric(metricName: string, value: number) {
  try {
    await cloudwatchClient.send(
      new PutMetricDataCommand({
        Namespace: 'Authorization/OpenFGA',
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Timestamp: new Date(),
            Unit: metricName.includes('Latency') ? 'Milliseconds' : 'Count',
          },
        ],
      })
    );
  } catch (error) {
    console.error('Failed to send metric:', error);
  }
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, any>
): APIGatewayAuthorizerResult {
  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      } as Statement,
    ],
  };

  return {
    principalId,
    policyDocument,
    context: context ? {
      ...context,
      // Ensure all values are strings
      ...Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, String(v)])
      ),
    } : undefined,
  };
}

/**
 * Lambda handler for API Gateway authorizer
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  console.log('Authorization request:', JSON.stringify(event, null, 2));

  try {
    // Extract JWT token from Authorization header
    const token = event.headers?.Authorization?.replace('Bearer ', '') ||
                  event.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new Error('No authorization token provided');
    }

    // Verify JWT token
    const payload = await verifier.verify(token);
    const userId = extractUserId(payload);
    const tenantId = extractTenantId(payload);

    console.log('Token verified:', { userId, tenantId });

    // Parse request path to extract resource information
    const pathParts = event.path.split('/').filter(Boolean);
    const method = event.httpMethod;

    // Example: /api/conversations/123 or /api/documents/new
    let resourceType = pathParts[1]; // 'conversations' or 'documents'
    let resourceId = pathParts[2] || 'new';

    // Normalize resource type (remove plural)
    resourceType = resourceType.replace(/s$/, '');

    // Determine permission based on method and resource
    const permission = mapMethodToPermission(method, resourceType, resourceId);

    console.log('Authorization check:', { resourceType, resourceId, permission });

    // Get tenant plan for quota checking
    const tenantPlan = await getTenantPlan(tenantId);
    if (!tenantPlan || tenantPlan.status !== 'active') {
      console.warn('No active plan for tenant:', tenantId);
      return generatePolicy(userId, 'Deny', event.methodArn);
    }

    const planDetails = await getPlanDetails(tenantPlan.plan_id);

    // Initialize OpenFGA client
    const fgaClient = await getOpenFGAClient();

    // For model execution, check quota
    let context: any = undefined;
    if (resourceType === 'model' || resourceType === 'model_with_quota') {
      const today = new Date().toISOString().split('T')[0];
      const currentUsage = await getCurrentUsage(tenantId, resourceId, today);
      const quotaLimit = planDetails?.models?.[resourceId]?.daily_quota || 0;

      context = {
        data: {
          current_usage: currentUsage,
          quota_limit: quotaLimit,
        },
      };

      console.log('Quota check:', { currentUsage, quotaLimit });

      // Quick pre-check for quota
      if (currentUsage >= quotaLimit) {
        await sendMetric('QuotaExceeded', 1);
        console.warn('Quota exceeded:', { currentUsage, quotaLimit });
        return generatePolicy(userId, 'Deny', event.methodArn, {
          reason: 'quota_exceeded',
          current_usage: String(currentUsage),
          quota_limit: String(quotaLimit),
        });
      }
    }

    // Check permission with OpenFGA
    const resource = `${resourceType}:${resourceId}`;
    const allowed = await checkPermission(fgaClient, userId, resource, permission, context);

    console.log('Authorization result:', { allowed });

    if (allowed) {
      return generatePolicy(userId, 'Allow', event.methodArn, {
        userId,
        tenantId,
        planId: tenantPlan.plan_id,
      });
    } else {
      return generatePolicy(userId, 'Deny', event.methodArn, {
        reason: 'permission_denied',
      });
    }
  } catch (error) {
    console.error('Authorization error:', error);
    await sendMetric('AuthorizationError', 1);

    // Return Deny on error (fail closed)
    return generatePolicy('unknown', 'Deny', event.methodArn, {
      reason: 'authorization_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
