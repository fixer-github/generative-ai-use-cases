import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  getTenantCredentials,
  getTenantCredentialsFromToken,
} from './tenantCredentials';
import { isDefaultTenant } from './tenantS3Utils';
import { getTenant } from '../tenantManager';

const stsClient = new STSClient();

/**
 * Create a DynamoDB client with tenant-isolated credentials from Cognito Identity Pool
 * IAM policies automatically restrict access to tenant-specific resources via principal tags
 * NOTE: No caching to ensure proper user isolation within tenants
 */
export async function createTenantDynamoDBClient(
  event: APIGatewayProxyEvent
): Promise<DynamoDBClient> {
  try {
    // Get fresh credentials and tenant info for each request to ensure proper user isolation
    const { credentials, tenant } = await getTenantCredentials(event);

    if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
      throw new Error(
        'Invalid credentials received from AssumeRoleWithWebIdentity'
      );
    }

    if (!tenant.region) {
      throw new Error(
        `Tenant ${tenant.tenantId} is missing region information`
      );
    }

    console.log(
      `Creating DynamoDB client for tenant ${tenant.tenantId} in region ${tenant.region}`
    );

    // Create DynamoDB client with tenant role credentials and tenant's region
    return new DynamoDBClient({
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      },
      region: tenant.region,
    });
  } catch (error) {
    console.error('Failed to create tenant DynamoDB client:', error);
    throw error; // 元のエラーをそのまま再スローし、エラータイプ情報を保持
  }
}

/**
 * Create a DynamoDB client with tenant-isolated credentials for background jobs
 * Uses STS AssumeRole to access cross-account tenant resources
 * For use in background lambdas that don't have API Gateway events
 * NOTE: No caching to ensure proper security isolation
 * @param tenantId - The tenant ID
 */
export async function createTenantDynamoDBClientForBackgroundJob(
  tenantId: string
): Promise<DynamoDBClient> {
  // Use default credentials for default tenant (single account deployment)
  if (isDefaultTenant(tenantId)) {
    console.log(
      `Using local credentials for default tenant: ${tenantId}`
    );
    return new DynamoDBClient({ region: process.env.AWS_REGION! });
  }

  // Get tenant info to get role ARN and region
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    // For single account deployment, tenant might not be in the table
    // Check if this looks like the default tenant (shouldn't reach here due to isDefaultTenant check above)
    console.warn(
      `Tenant ${tenantId} not found in Tenants table. ` +
        `For single account deployment, ensure DEFAULT_TENANT_ID env var is set correctly.`
    );
    throw new Error(
      `Tenant ${tenantId} not found in Tenants table. ` +
        `For single account deployment, use the default tenant ID.`
    );
  }
  if (!tenant.roleArn) {
    throw new Error(
      `Tenant ${tenantId} is missing roleArn configuration. ` +
        `Cross-account tenant access requires roleArn to be set in the Tenants table.`
    );
  }
  if (!tenant.region) {
    throw new Error(
      `Tenant ${tenantId} is missing region configuration. ` +
        `Cross-account tenant access requires region to be set in the Tenants table.`
    );
  }

  console.log(`Assuming role for tenant ${tenantId}: ${tenant.roleArn}`);

  // Assume tenant role for cross-account access
  try {
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: tenant.roleArn,
      RoleSessionName: `BackgroundJob-${tenantId}`,
    });

    const response = await stsClient.send(assumeRoleCommand);
    if (!response.Credentials) {
      throw new Error(`Failed to assume role for tenant: ${tenantId}`);
    }

    return new DynamoDBClient({
      region: tenant.region,
      credentials: {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken!,
      },
    });
  } catch (error) {
    console.error(
      `Failed to get tenant-specific DynamoDB client for tenant ${tenantId}:`,
      error
    );
    throw new Error(`Cannot access tenant resources: ${error}`);
  }
}

/**
 * Create a DynamoDB client with tenant-isolated credentials from ID token
 * Uses AssumeRoleWithWebIdentity to access tenant resources via Cognito Identity Pool
 * For use in lambdas that receive ID token but not API Gateway events (e.g., PredictStream)
 * NOTE: No caching to ensure proper user isolation within tenants
 * @param idToken - Cognito User Pool ID token (JWT)
 */
export async function createTenantDynamoDBClientFromToken(
  idToken: string
): Promise<DynamoDBClient> {
  try {
    // Get fresh credentials and tenant info for each request to ensure proper user isolation
    const { credentials, tenant } = await getTenantCredentialsFromToken(
      idToken
    );

    if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
      throw new Error(
        'Invalid credentials received from AssumeRoleWithWebIdentity'
      );
    }

    if (!tenant.region) {
      throw new Error(
        `Tenant ${tenant.tenantId} is missing region information`
      );
    }

    console.log(
      `Creating DynamoDB client for tenant ${tenant.tenantId} in region ${tenant.region} (from token)`
    );

    // Create DynamoDB client with tenant role credentials and tenant's region
    return new DynamoDBClient({
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      },
      region: tenant.region,
    });
  } catch (error) {
    console.error('Failed to create tenant DynamoDB client from token:', error);
    throw new Error(
      `Failed to create tenant-isolated DynamoDB client: ${error}`
    );
  }
}
