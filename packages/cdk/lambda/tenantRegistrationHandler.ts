import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  CloudFormationCustomResourceResponseStatus,
  Context,
} from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

// Environment variables
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME!;
const TENANTS_KMS_KEY_ID = process.env.TENANTS_KMS_KEY_ID!;

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION! });

// Tenant status enum
enum TenantStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PROVISIONING = 'provisioning',
  ERROR = 'error',
}

// Tenant interface
interface Tenant {
  tenantId: string;
  status: TenantStatus;
  accountId: string;
  region: string;
  environment: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

/**
 * CloudFormation Custom Resource handler for tenant registration
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<CloudFormationCustomResourceResponse> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties } = event;
  const { tenantId, accountId, region, environment } = ResourceProperties;

  let response: CloudFormationCustomResourceResponse = {
    Status: CloudFormationCustomResourceResponseStatus.SUCCESS,
    PhysicalResourceId: `tenant-registration-${tenantId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  };

  try {
    switch (RequestType) {
      case 'Create':
        await createTenant({
          tenantId,
          accountId,
          region,
          environment,
        });
        response.Data = { tenantId, status: TenantStatus.PROVISIONING };
        break;

      case 'Update':
        await updateTenant({
          tenantId,
          accountId,
          region,
          environment,
        });
        response.Data = { tenantId, status: TenantStatus.ACTIVE };
        break;

      case 'Delete':
        await deleteTenant(tenantId);
        response.Data = { tenantId, status: TenantStatus.INACTIVE };
        break;

      default:
        throw new Error(`Unknown request type: ${RequestType}`);
    }
  } catch (error) {
    console.error('Error handling tenant registration:', error);
    
    // Try to mark tenant as error state if it exists
    if (RequestType === 'Create' || RequestType === 'Update') {
      try {
        await markTenantAsError(tenantId);
      } catch (updateError) {
        console.error('Failed to mark tenant as error:', updateError);
      }
    }

    response.Status = CloudFormationCustomResourceResponseStatus.FAILED;
    response.Reason = error instanceof Error ? error.message : 'Unknown error';
  }

  console.log('Response:', JSON.stringify(response, null, 2));
  return response;
};

/**
 * Create a new tenant record
 */
async function createTenant(params: {
  tenantId: string;
  accountId: string;
  region: string;
  environment: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const tenant: Tenant = {
    tenantId: params.tenantId,
    status: TenantStatus.PROVISIONING,
    accountId: params.accountId,
    region: params.region,
    environment: params.environment,
    createdAt: now,
    updatedAt: now,
    metadata: {
      source: 'cdk-deployment',
      deploymentContext: 'tenant-stack',
    },
  };

  await dynamoClient.send(
    new PutItemCommand({
      TableName: TENANTS_TABLE_NAME,
      Item: marshall(tenant),
      ConditionExpression: 'attribute_not_exists(tenantId)',
    })
  );

  console.log(`Successfully registered tenant: ${params.tenantId}`);
}

/**
 * Update existing tenant record to active status
 */
async function updateTenant(params: {
  tenantId: string;
  accountId: string;
  region: string;
  environment: string;
}): Promise<void> {
  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: TENANTS_TABLE_NAME,
      Key: marshall({ tenantId: params.tenantId }),
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #accountId = :accountId, #region = :region, #environment = :environment',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#accountId': 'accountId',
        '#region': 'region',
        '#environment': 'environment',
      },
      ExpressionAttributeValues: marshall({
        ':status': TenantStatus.ACTIVE,
        ':updatedAt': now,
        ':accountId': params.accountId,
        ':region': params.region,
        ':environment': params.environment,
      }),
      ConditionExpression: 'attribute_exists(tenantId)',
    })
  );

  console.log(`Successfully updated tenant to active: ${params.tenantId}`);
}

/**
 * Mark tenant as inactive (soft delete)
 */
async function deleteTenant(tenantId: string): Promise<void> {
  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: TENANTS_TABLE_NAME,
      Key: marshall({ tenantId }),
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: marshall({
        ':status': TenantStatus.INACTIVE,
        ':updatedAt': now,
      }),
      ConditionExpression: 'attribute_exists(tenantId)',
    })
  );

  console.log(`Successfully marked tenant as inactive: ${tenantId}`);
}

/**
 * Mark tenant as error state
 */
async function markTenantAsError(tenantId: string): Promise<void> {
  const now = new Date().toISOString();

  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: TENANTS_TABLE_NAME,
      Key: marshall({ tenantId }),
      UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: marshall({
        ':status': TenantStatus.ERROR,
        ':updatedAt': now,
      }),
      // Don't require tenant to exist for error marking
    })
  );

  console.log(`Marked tenant as error: ${tenantId}`);
}