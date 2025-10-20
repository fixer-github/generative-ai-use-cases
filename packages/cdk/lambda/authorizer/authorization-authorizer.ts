/**
 * Lambda Authorizer for Authorization System
 * 認可システムLambda Authorizer
 *
 * This function integrates with API Gateway to provide centralized authorization
 * using SpiceDB for relationship-based access control and DynamoDB for quota management.
 */

import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { v1 } from '@authzed/authzed-node';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';

// Environment variables
const {
  COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID,
  SPICEDB_ENDPOINT,
  SPICEDB_TOKEN,
  DYNAMODB_PLAN_TABLE,
  DYNAMODB_TENANT_PLAN_TABLE,
  DYNAMODB_USAGE_TABLE,
  CACHE_ENABLED = 'true',
  CACHE_TTL_SECONDS = '300',
} = process.env;

// Client initialization
const cognitoVerifier = CognitoJwtVerifier.create({
  userPoolId: COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: COGNITO_CLIENT_ID || undefined, // Optional for access tokens
});

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cloudwatch = new CloudWatchClient({});

// SpiceDB client (lazy initialization)
let spiceDBClient: v1.ZedClient | null = null;

function getSpiceDBClient(): v1.ZedClient {
  if (!spiceDBClient) {
    spiceDBClient = v1.NewClient(
      SPICEDB_ENDPOINT!,
      v1.ClientSecurity.newInsecureBearerToken(SPICEDB_TOKEN!)
    );
  }
  return spiceDBClient;
}

// Cache for authorization decisions
interface CacheEntry {
  allowed: boolean;
  timestamp: number;
}

const authzCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = parseInt(CACHE_TTL_SECONDS) * 1000;

// Cognito JWT Payload
interface CognitoJWTPayload {
  sub: string;
  email?: string;
  'custom:tenant_id': string;
  'custom:tenantAdmin'?: string;
  token_use: 'access' | 'id';
  iat: number;
  exp: number;
}

// Plan Info
interface PlanInfo {
  plan_id: string;
  plan_name: string;
  permissions: {
    usecases: Record<string, { enabled: boolean }>;
    models: Record<string, { enabled: boolean; daily_quota: number }>;
  };
}

// Resource Info
interface ResourceInfo {
  type: string;
  id: string;
  action: string;
}

// Main handler
export async function handler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  const startTime = Date.now();

  console.log('Authorization request:', JSON.stringify(event, null, 2));

  try {
    // 1. Extract and verify JWT token
    const token = extractToken(event);
    const payload = (await cognitoVerifier.verify(token)) as CognitoJWTPayload;

    const userId = payload.sub;
    const tenantId = payload['custom:tenant_id'];
    const isTenantAdmin = payload['custom:tenantAdmin'] === 'true';

    console.log(
      `User: ${userId}, Tenant: ${tenantId}, Admin: ${isTenantAdmin}`
    );

    // 2. Extract resource information
    const resourceInfo = extractResourceInfo(event);

    // 3. Get plan information
    const planInfo = await getPlanInfo(tenantId);

    // 4. Perform authorization check
    const authzDecision = await performAuthorizationCheck({
      userId,
      tenantId,
      isTenantAdmin,
      planInfo,
      resourceInfo,
    });

    // 5. Record metrics
    await recordMetrics({
      decision: authzDecision.allowed ? 'Allow' : 'Deny',
      latency_ms: Date.now() - startTime,
      resource_type: resourceInfo.type,
      tenant_id: tenantId,
    });

    // 6. Generate IAM policy
    const policy = generatePolicy(
      userId,
      authzDecision.allowed ? 'Allow' : 'Deny',
      event.methodArn,
      {
        tenantId,
        userId,
        planId: planInfo.plan_id,
        resourceType: resourceInfo.type,
        resourceId: resourceInfo.id,
        isTenantAdmin: isTenantAdmin.toString(),
      }
    );

    console.log(
      `Authorization ${authzDecision.allowed ? 'ALLOWED' : 'DENIED'}: ${authzDecision.reason}`
    );

    return policy;
  } catch (error) {
    console.error('Authorization error:', error);

    // Record error metric
    await recordMetrics({
      decision: 'Error',
      latency_ms: Date.now() - startTime,
      resource_type: 'unknown',
      tenant_id: 'unknown',
    });

    return generatePolicy('unknown', 'Deny', event.methodArn);
  }
}

// Extract JWT token from Authorization header
function extractToken(event: APIGatewayRequestAuthorizerEvent): string {
  const authHeader =
    event.headers?.['Authorization'] || event.headers?.['authorization'];

  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    throw new Error('Invalid authorization header format');
  }

  return match[1];
}

// Extract resource information from request
function extractResourceInfo(
  event: APIGatewayRequestAuthorizerEvent
): ResourceInfo {
  const path = event.path || event.requestContext?.resourcePath || '';
  const method = event.httpMethod || event.requestContext?.httpMethod || 'GET';

  const pathParts = path.split('/').filter(Boolean);

  // Admin operations
  if (pathParts.includes('admin')) {
    return {
      type: 'admin_operation',
      id: pathParts.join('_'),
      action: 'execute',
    };
  }

  // Conversations
  if (pathParts.includes('conversations')) {
    const conversationId =
      pathParts[pathParts.indexOf('conversations') + 1] || 'new';
    return {
      type: 'conversation',
      id: conversationId,
      action: methodToAction(method, 'conversation'),
    };
  }

  // Documents
  if (pathParts.includes('documents')) {
    const documentId = pathParts[pathParts.indexOf('documents') + 1] || 'new';
    return {
      type: 'document',
      id: documentId,
      action: methodToAction(method, 'document'),
    };
  }

  // Default: usecase execution
  return {
    type: 'usecase',
    id: pathParts[pathParts.length - 1] || 'chat',
    action: 'execute',
  };
}

function methodToAction(method: string, resourceType?: string): string {
  switch (method) {
    case 'GET':
      return 'view';
    case 'POST':
      // POST maps to different permissions based on resource type
      // - document: upload permission
      // - conversation: view permission (creation is implicit via tenant membership)
      // - others: execute permission
      if (resourceType === 'document') {
        return 'upload';
      } else if (resourceType === 'conversation') {
        return 'view'; // Check if user can view conversations in this tenant
      }
      return 'execute';
    case 'PUT':
    case 'PATCH':
      return 'edit';
    case 'DELETE':
      return 'delete';
    default:
      return 'execute';
  }
}

// Get plan information from DynamoDB
async function getPlanInfo(tenantId: string): Promise<PlanInfo> {
  // Get tenant plan assignment
  const tenantPlanResult = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_TENANT_PLAN_TABLE,
      Key: { tenant_id: tenantId },
    })
  );

  const planId = tenantPlanResult.Item?.plan_id || 'free';

  // Get plan permissions
  const planResult = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_PLAN_TABLE,
      Key: { plan_id: planId },
    })
  );

  if (!planResult.Item) {
    // Return default free plan
    return {
      plan_id: 'free',
      plan_name: 'Free',
      permissions: {
        usecases: { chat: { enabled: true } },
        models: {
          'claude-3-haiku': { enabled: true, daily_quota: 10 },
        },
      },
    };
  }

  return {
    plan_id: planResult.Item.plan_id,
    plan_name: planResult.Item.plan_name,
    permissions: planResult.Item.features || planResult.Item.permissions,
  };
}

// Authorization check parameters
interface AuthzCheckParams {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
  planInfo: PlanInfo;
  resourceInfo: ResourceInfo;
}

interface AuthzDecision {
  allowed: boolean;
  reason: string;
}

// Perform authorization check
async function performAuthorizationCheck(
  params: AuthzCheckParams
): Promise<AuthzDecision> {
  // Admin operations require tenant admin
  if (params.resourceInfo.type === 'admin_operation') {
    return {
      allowed: params.isTenantAdmin,
      reason: params.isTenantAdmin
        ? 'Tenant admin privilege'
        : 'Not a tenant admin',
    };
  }

  // Usecase execution: check plan + quota
  if (params.resourceInfo.type === 'usecase') {
    return await checkUsecasePermission(params);
  }

  // Resource access: check SpiceDB
  return await checkResourcePermission(params);
}

// Check usecase permission (plan + quota)
async function checkUsecasePermission(
  params: AuthzCheckParams
): Promise<AuthzDecision> {
  const usecaseId = params.resourceInfo.id;

  // Check if usecase is allowed by plan
  if (!params.planInfo.permissions.usecases[usecaseId]?.enabled) {
    return {
      allowed: false,
      reason: `Usecase ${usecaseId} not allowed in plan ${params.planInfo.plan_id}`,
    };
  }

  // Model would be extracted from request body/query params in real implementation
  // For now, use default model
  const model = 'claude-3-haiku';

  const modelConfig = params.planInfo.permissions.models[model];
  if (!modelConfig?.enabled) {
    return {
      allowed: false,
      reason: `Model ${model} not allowed in plan`,
    };
  }

  // Check quota
  const currentUsage = await getCurrentUsage(params.tenantId, model);
  if (currentUsage >= modelConfig.daily_quota) {
    return {
      allowed: false,
      reason: `Daily quota exceeded for ${model} (${currentUsage}/${modelConfig.daily_quota})`,
    };
  }

  return {
    allowed: true,
    reason: 'Usecase and quota check passed',
  };
}

// Check resource permission via SpiceDB
async function checkResourcePermission(
  params: AuthzCheckParams
): Promise<AuthzDecision> {
  // For creating new resources (id='new'), check tenant-level permission instead
  let resourceType = params.resourceInfo.type;
  let resourceId = params.resourceInfo.id;
  let permission = params.resourceInfo.action;

  if (resourceId === 'new') {
    // Check against tenant for create operations
    resourceType = 'tenant';
    resourceId = params.tenantId;
    permission = 'view'; // Check if user is a member of the tenant
  }

  const cacheKey = `${params.userId}:${resourceType}:${resourceId}:${permission}`;

  // Check cache
  if (CACHE_ENABLED === 'true') {
    const cached = authzCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        allowed: cached.allowed,
        reason: 'Cached decision',
      };
    }
  }

  // SpiceDB check
  const client = getSpiceDBClient();

  try {
    const checkRequest = v1.CheckPermissionRequest.create({
      consistency: v1.Consistency.create({
        requirement: {
          oneofKind: 'fullyConsistent',
          fullyConsistent: true,
        },
      }),
      resource: v1.ObjectReference.create({
        objectType: resourceType,
        objectId: resourceId,
      }),
      permission: permission,
      subject: v1.SubjectReference.create({
        object: v1.ObjectReference.create({
          objectType: 'user',
          objectId: params.userId,
        }),
      }),
    });

    const response = await client.checkPermission(checkRequest);

    const allowed =
      response.permissionship ===
      v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION;

    // Cache result
    if (CACHE_ENABLED === 'true') {
      authzCache.set(cacheKey, {
        allowed,
        timestamp: Date.now(),
      });
    }

    return {
      allowed,
      reason: allowed
        ? 'Permission granted by SpiceDB'
        : 'Permission denied by SpiceDB',
    };
  } catch (error) {
    console.error('SpiceDB check error:', error);
    return {
      allowed: false,
      reason: `SpiceDB error: ${error}`,
    };
  }
}

// Get current usage from DynamoDB
async function getCurrentUsage(
  tenantId: string,
  model: string
): Promise<number> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const result = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_USAGE_TABLE,
      Key: {
        pk: `${tenantId}#model`,
        sk: `${today}#${model}`,
      },
    })
  );

  return result.Item?.count || 0;
}

// Generate IAM policy
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: context || {},
  };
}

// Record CloudWatch metrics
async function recordMetrics(params: {
  decision: string;
  latency_ms: number;
  resource_type: string;
  tenant_id: string;
}): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: 'Authorization/Authorizer',
        MetricData: [
          {
            MetricName: 'AuthorizationDecision',
            Value: params.decision === 'Allow' ? 1 : 0,
            Unit: 'Count',
            Dimensions: [
              { Name: 'Decision', Value: params.decision },
              { Name: 'ResourceType', Value: params.resource_type },
              { Name: 'TenantId', Value: params.tenant_id },
            ],
          },
          {
            MetricName: 'AuthorizationLatency',
            Value: params.latency_ms,
            Unit: 'Milliseconds',
            Dimensions: [
              { Name: 'ResourceType', Value: params.resource_type },
            ],
          },
        ],
      })
    );
  } catch (error) {
    console.error('Failed to record metrics:', error);
  }
}
