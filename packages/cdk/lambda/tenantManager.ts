import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { KMSClient } from '@aws-sdk/client-kms';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Environment variables
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME!;
const TENANTS_KMS_KEY_ID = process.env.TENANTS_KMS_KEY_ID!;

// DynamoDB and KMS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION! });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION! });

// Common response headers
const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// Helper functions to reduce code duplication
const createSuccessResponse = (statusCode: number, data: any) => ({
  statusCode,
  headers: COMMON_HEADERS,
  body: JSON.stringify(data),
});

const createErrorResponse = (statusCode: number, error: string, message?: string) => ({
  statusCode,
  headers: COMMON_HEADERS,
  body: JSON.stringify({ error, ...(message && { message }) }),
});

// Tenant status enum
export enum TenantStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROVISIONING = 'provisioning',
  ERROR = 'error',
}

// Tenant interface
export interface Tenant {
  tenantId: string;
  status: TenantStatus;
  region: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
  // Phase 2 fields (placeholder, not used in Phase 1)
  accountId?: string;
  encryptedCrossAccountRoleArn?: string;
}

// Request interfaces
interface RegisterTenantRequest {
  tenantId: string;
  region?: string;
  metadata?: Record<string, any>;
}

interface UpdateTenantRequest {
  tenantId: string;
  status?: TenantStatus;
  region?: string;
  metadata?: Record<string, any>;
}

/**
 * Get tenant information by tenant ID
 */
export async function getTenant(tenantId: string): Promise<Tenant | null> {
  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: TENANTS_TABLE_NAME,
        Key: marshall({ tenantId }),
      })
    );

    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Tenant;
  } catch (error) {
    console.error(`Failed to get tenant ${tenantId}:`, error);
    throw new Error(`Failed to get tenant: ${error}`);
  }
}

/**
 * Register a new tenant
 */
export async function registerTenant(
  request: RegisterTenantRequest
): Promise<Tenant> {
  const now = new Date().toISOString();
  const tenant: Tenant = {
    tenantId: request.tenantId,
    status: TenantStatus.PROVISIONING,
    region: request.region || process.env.AWS_REGION!,
    createdAt: now,
    updatedAt: now,
    metadata: request.metadata || {},
  };

  try {
    // Check if tenant already exists
    const existing = await getTenant(request.tenantId);
    if (existing) {
      throw new Error(`Tenant ${request.tenantId} already exists`);
    }

    await dynamoClient.send(
      new PutItemCommand({
        TableName: TENANTS_TABLE_NAME,
        Item: marshall(tenant),
        ConditionExpression: 'attribute_not_exists(tenantId)',
      })
    );

    console.log(`Successfully registered tenant: ${request.tenantId}`);
    return tenant;
  } catch (error) {
    console.error(`Failed to register tenant ${request.tenantId}:`, error);
    throw new Error(`Failed to register tenant: ${error}`);
  }
}

/**
 * Update tenant information
 */
export async function updateTenant(
  request: UpdateTenantRequest
): Promise<Tenant> {
  try {
    // Check if tenant exists
    const existing = await getTenant(request.tenantId);
    if (!existing) {
      throw new Error(`Tenant ${request.tenantId} not found`);
    }

    const now = new Date().toISOString();
    const updateExpression: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Build update expression dynamically
    if (request.status !== undefined) {
      updateExpression.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = request.status;
    }

    if (request.region !== undefined) {
      updateExpression.push('#region = :region');
      expressionAttributeNames['#region'] = 'region';
      expressionAttributeValues[':region'] = request.region;
    }

    if (request.metadata !== undefined) {
      updateExpression.push('#metadata = :metadata');
      expressionAttributeNames['#metadata'] = 'metadata';
      expressionAttributeValues[':metadata'] = request.metadata;
    }

    // Always update updatedAt
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now;

    const response = await dynamoClient.send(
      new UpdateItemCommand({
        TableName: TENANTS_TABLE_NAME,
        Key: marshall({ tenantId: request.tenantId }),
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
        ReturnValues: 'ALL_NEW',
      })
    );

    const updatedTenant = unmarshall(response.Attributes!) as Tenant;
    console.log(`Successfully updated tenant: ${request.tenantId}`);
    return updatedTenant;
  } catch (error) {
    console.error(`Failed to update tenant ${request.tenantId}:`, error);
    throw new Error(`Failed to update tenant: ${error}`);
  }
}

/**
 * Deactivate a tenant
 */
export async function deactivateTenant(tenantId: string): Promise<Tenant> {
  return updateTenant({
    tenantId,
    status: TenantStatus.INACTIVE,
  });
}

/**
 * Lambda handler for tenant management operations
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('TenantManager handler called with event:', JSON.stringify(event));

  try {
    const httpMethod = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const tenantId = pathParameters.tenantId;

    switch (httpMethod) {
      case 'GET':
        if (!tenantId) {
          return createErrorResponse(400, 'Tenant ID is required');
        }

        const tenant = await getTenant(tenantId);
        if (!tenant) {
          return createErrorResponse(404, 'Tenant not found');
        }

        return createSuccessResponse(200, tenant);

      case 'POST':
        const registerRequest = JSON.parse(event.body || '{}') as RegisterTenantRequest;
        if (!registerRequest.tenantId) {
          return createErrorResponse(400, 'Tenant ID is required');
        }

        const newTenant = await registerTenant(registerRequest);
        return createSuccessResponse(201, newTenant);

      case 'PUT':
        if (!tenantId) {
          return createErrorResponse(400, 'Tenant ID is required');
        }

        const updateRequest = JSON.parse(event.body || '{}') as UpdateTenantRequest;
        updateRequest.tenantId = tenantId;

        const updatedTenant = await updateTenant(updateRequest);
        return createSuccessResponse(200, updatedTenant);

      case 'DELETE':
        if (!tenantId) {
          return createErrorResponse(400, 'Tenant ID is required');
        }

        const deactivatedTenant = await deactivateTenant(tenantId);
        return createSuccessResponse(200, deactivatedTenant);

      default:
        return createErrorResponse(405, 'Method not allowed');
    }
  } catch (error) {
    console.error('TenantManager error:', error);
    return createErrorResponse(
      500,
      'Internal server error',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
};