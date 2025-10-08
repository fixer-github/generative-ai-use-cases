import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantCredentials } from './tenantCredentials';
import { isDefaultTenant } from './tenantS3Utils';

const MULTI_TENANT_ROLE_ARN = process.env.MULTI_TENANT_ROLE_ARN!;
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
    throw new Error(
      `Failed to create tenant-isolated DynamoDB client: ${error}`
    );
  }
}

/**
 * Create a DynamoDB client with tenant-isolated credentials for background jobs
 * Uses STS AssumeRole with session tags to maintain ABAC security
 * For use in background lambdas that don't have API Gateway events
 * NOTE: No caching to ensure proper security isolation
 * @param tenantId - The tenant ID
 * @param tenantRegion - The tenant's region (required for cross-account tenants)
 */
export async function createTenantDynamoDBClientForBackgroundJob(
  tenantId: string,
  tenantRegion?: string
): Promise<DynamoDBClient> {
  // Use default credentials for default tenant
  if (isDefaultTenant(tenantId)) {
    return new DynamoDBClient({ region: tenantRegion || process.env.AWS_REGION! });
  }

  // Assume multi-tenant role with tenant ID as session tag for ABAC
  try {
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: MULTI_TENANT_ROLE_ARN,
      RoleSessionName: `BackgroundJob-${tenantId}`,
      Tags: [
        {
          Key: 'TenantID',
          Value: tenantId,
        },
      ],
    });

    const response = await stsClient.send(assumeRoleCommand);
    if (!response.Credentials) {
      throw new Error(`Failed to assume role for tenant: ${tenantId}`);
    }

    return new DynamoDBClient({
      region: tenantRegion || process.env.AWS_REGION!,
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
    // Fall back to default credentials
    console.warn(`Falling back to default DynamoDB client for tenant: ${tenantId}`);
    return new DynamoDBClient({ region: tenantRegion || process.env.AWS_REGION! });
  }
}
