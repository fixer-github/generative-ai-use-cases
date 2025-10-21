/**
 * Lambda Authorizer for Authorization System
 * 認可システムLambda Authorizer
 *
 * This function integrates with API Gateway to provide centralized authorization
 * using OpenFGA for relationship-based access control and PostgreSQL for quota management.
 */

import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { Client } from 'pg';
import {
  checkUsecasePermission,
  checkModelPermission,
  checkResourcePermission,
  QuotaContext,
} from '../utils/openfgaClient';

// Environment variables
const {
  COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID,
  OPENFGA_API_URL,
  OPENFGA_STORE_ID,
  OPENFGA_MODEL_ID,
  OPENFGA_KEY_SECRET_ARN,
  DB_ENDPOINT,
  DB_NAME,
  DB_SECRET_ARN,
  CACHE_ENABLED = 'true',
  CACHE_TTL_SECONDS = '300',
} = process.env;

// Validate required environment variables
if (!OPENFGA_API_URL || !OPENFGA_STORE_ID || !OPENFGA_KEY_SECRET_ARN) {
  throw new Error(
    'Missing required OpenFGA configuration: OPENFGA_API_URL, OPENFGA_STORE_ID, OPENFGA_KEY_SECRET_ARN'
  );
}

// Client initialization
const cognitoVerifier = CognitoJwtVerifier.create(
  COGNITO_CLIENT_ID
    ? {
        userPoolId: COGNITO_USER_POOL_ID!,
        tokenUse: 'access',
        clientId: COGNITO_CLIENT_ID,
      }
    : {
        userPoolId: COGNITO_USER_POOL_ID!,
        tokenUse: 'access',
      }
);

const secretsManager = new SecretsManagerClient({});
const cloudwatch = new CloudWatchClient({});

// Database connection pool (reused across Lambda invocations)
let dbClient: Client | null = null;
let dbCredentials: { username: string; password: string } | null = null;

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

/**
 * Main Lambda Handler
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  try {
    // Extract and verify JWT token
    const token = extractToken(event);
    if (!token) {
      return generatePolicy('user', 'Deny', event.methodArn);
    }

    // Verify Cognito JWT
    const payload = await verifyToken(token);
    if (!payload) {
      return generatePolicy('user', 'Deny', event.methodArn);
    }

    const userId = payload.sub;
    const tenantId = payload['custom:tenant_id'];
    const email = payload.email || '';

    // Determine permission type from request
    const permissionCheck = determinePermissionCheck(event);
    if (!permissionCheck) {
      // If no specific permission is required, allow (fallback)
      return generatePolicy(userId, 'Allow', event.methodArn, {
        userId,
        tenantId,
        email,
      });
    }

    // Check cache
    const cacheKey = `${userId}:${permissionCheck.type}:${permissionCheck.id}`;
    if (CACHE_ENABLED === 'true') {
      const cached = authzCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        await recordMetric('CacheHit', 1);
        return generatePolicy(
          userId,
          cached.allowed ? 'Allow' : 'Deny',
          event.methodArn,
          {
            userId,
            tenantId,
            email,
          }
        );
      }
    }

    // Perform authorization check based on type
    let allowed = false;
    let reason: string | undefined;

    switch (permissionCheck.type) {
      case 'usecase':
        const usecaseResult = await checkUsecasePermission(
          userId,
          permissionCheck.id
        );
        allowed = usecaseResult.allowed;
        reason = usecaseResult.reason;
        break;

      case 'model':
        // Get quota context from DynamoDB
        const quotaContext = await getQuotaContext(userId, tenantId, permissionCheck.id);
        const modelResult = await checkModelPermission(
          userId,
          permissionCheck.id,
          quotaContext
        );
        allowed = modelResult.allowed;
        reason = modelResult.reason;
        break;

      case 'resource':
        if (!permissionCheck.resourceType || !permissionCheck.permission) {
          allowed = false;
          reason = 'missing_resource_info';
          break;
        }
        const resourceResult = await checkResourcePermission(
          userId,
          permissionCheck.resourceType as 'conversation' | 'document',
          permissionCheck.id,
          permissionCheck.permission as 'view' | 'edit' | 'delete' | 'upload'
        );
        allowed = resourceResult.allowed;
        reason = resourceResult.reason;
        break;

      default:
        allowed = false;
        reason = 'unknown_permission_type';
    }

    // Update cache
    if (CACHE_ENABLED === 'true') {
      authzCache.set(cacheKey, { allowed, timestamp: Date.now() });
      await recordMetric('CacheMiss', 1);
    }

    // Record authorization decision metric
    await recordMetric(allowed ? 'AuthorizationAllow' : 'AuthorizationDeny', 1);

    if (!allowed) {
      console.log(`Authorization denied for user ${userId}: ${reason}`);
      return generatePolicy(userId, 'Deny', event.methodArn);
    }

    return generatePolicy(userId, 'Allow', event.methodArn, {
      userId,
      tenantId,
      email,
      permissionType: permissionCheck.type,
      resourceId: permissionCheck.id,
    });
  } catch (error) {
    console.error('Authorization error:', error);
    await recordMetric('AuthorizationError', 1);
    return generatePolicy('user', 'Deny', event.methodArn);
  }
}

/**
 * Extract JWT token from Authorization header
 */
function extractToken(event: APIGatewayRequestAuthorizerEvent): string | null {
  const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Verify Cognito JWT token
 */
async function verifyToken(token: string): Promise<CognitoJWTPayload | null> {
  try {
    const verifyOptions = COGNITO_CLIENT_ID ? { clientId: COGNITO_CLIENT_ID } : {};
    const payload = await cognitoVerifier.verify(token, verifyOptions as any);
    return payload as unknown as CognitoJWTPayload;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

/**
 * Determine what permission to check based on request
 */
function determinePermissionCheck(
  event: APIGatewayRequestAuthorizerEvent
): {
  type: 'usecase' | 'model' | 'resource';
  id: string;
  resourceType?: string;
  permission?: string;
} | null {
  const path = event.path || event.requestContext?.path;
  const method = event.httpMethod || event.requestContext?.httpMethod;

  // Parse path to determine resource and action
  if (!path || !method) {
    return null;
  }

  // Example: /chat -> usecase:chat
  if (path.startsWith('/chat')) {
    return { type: 'usecase', id: 'chat' };
  }

  // Example: /rag -> usecase:rag
  if (path.startsWith('/rag')) {
    return { type: 'usecase', id: 'rag' };
  }

  // Example: /models/{modelId} -> model:modelId
  const modelMatch = path.match(/^\/models\/([^\/]+)/);
  if (modelMatch) {
    return { type: 'model', id: modelMatch[1] };
  }

  // Example: /conversations/{id} -> resource:conversation:id
  const conversationMatch = path.match(/^\/conversations\/([^\/]+)/);
  if (conversationMatch) {
    const permission = method === 'GET' ? 'view' : method === 'DELETE' ? 'delete' : 'edit';
    return {
      type: 'resource',
      id: conversationMatch[1],
      resourceType: 'conversation',
      permission,
    };
  }

  // Example: /documents/{id} -> resource:document:id
  const documentMatch = path.match(/^\/documents\/([^\/]+)/);
  if (documentMatch) {
    const permission =
      method === 'GET'
        ? 'view'
        : method === 'DELETE'
        ? 'delete'
        : method === 'POST'
        ? 'upload'
        : 'edit';
    return {
      type: 'resource',
      id: documentMatch[1],
      resourceType: 'document',
      permission,
    };
  }

  // If no specific permission is matched, return null (will allow by default)
  return null;
}

/**
 * Get database connection (reuses connection across invocations)
 */
async function getDbConnection(): Promise<Client> {
  // Return existing connection if alive
  if (dbClient) {
    try {
      await dbClient.query('SELECT 1');
      return dbClient;
    } catch (error) {
      console.log('Existing connection dead, creating new one');
      dbClient = null;
    }
  }

  // Get credentials from Secrets Manager (cached)
  if (!dbCredentials) {
    const secretResponse = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: DB_SECRET_ARN,
      })
    );

    if (!secretResponse.SecretString) {
      throw new Error('Database secret is empty');
    }

    dbCredentials = JSON.parse(secretResponse.SecretString);
  }

  // Parse endpoint
  const [host, port] = DB_ENDPOINT!.split(':');

  // Create new connection
  dbClient = new Client({
    host,
    port: parseInt(port, 10),
    database: DB_NAME,
    user: dbCredentials.username,
    password: dbCredentials.password,
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 5000,
  });

  await dbClient.connect();
  console.log('New database connection established');

  return dbClient;
}

/**
 * Get quota context from PostgreSQL
 */
async function getQuotaContext(
  userId: string,
  tenantId: string,
  modelId: string
): Promise<QuotaContext | undefined> {
  try {
    const client = await getDbConnection();
    const today = new Date().toISOString().split('T')[0];

    // Get tenant's plan and quota limits
    const planResult = await client.query(
      `
      SELECT p.features
      FROM plans.tenant_plans tp
      JOIN plans.plans p ON p.plan_id = tp.plan_id
      WHERE tp.tenant_id = $1 AND tp.status = 'active'
      LIMIT 1
      `,
      [tenantId]
    );

    if (planResult.rows.length === 0) {
      console.warn(`No active plan found for tenant ${tenantId}`);
      return undefined;
    }

    const features = planResult.rows[0].features;
    const modelConfig = features?.models?.[modelId];

    if (!modelConfig || !modelConfig.enabled) {
      return {
        userCurrentUsage: 0,
        userQuotaLimit: 0,
      };
    }

    // Get user's current usage
    const usageResult = await client.query(
      `
      SELECT COALESCE(SUM(count), 0) as total_usage
      FROM plans.usage_counters
      WHERE tenant_id = $1
        AND model = $2
        AND date = $3
      `,
      [tenantId, modelId, today]
    );

    const currentUsage = parseInt(usageResult.rows[0]?.total_usage || '0', 10);
    const dailyQuota = modelConfig.daily_quota || 0;

    return {
      userCurrentUsage: currentUsage,
      userQuotaLimit: dailyQuota,
    };
  } catch (error) {
    console.error('Error fetching quota context:', error);
    return undefined;
  }
}

/**
 * Generate IAM policy for API Gateway
 */
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

/**
 * Record CloudWatch metric
 */
async function recordMetric(metricName: string, value: number): Promise<void> {
  try {
    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: 'Authorization',
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: 'Count',
            Timestamp: new Date(),
          },
        ],
      })
    );
  } catch (error) {
    console.error('Error recording metric:', error);
    // Don't fail authorization on metric error
  }
}
