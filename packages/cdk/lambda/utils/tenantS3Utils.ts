import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { getTenantId } from './tenantUtils';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Constants at file level
const ENVIRONMENT = process.env.ENVIRONMENT!;
const HASHED_ENVIRONMENT = process.env.HASHED_ENVIRONMENT!;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

/**
 * Generate tenant-specific S3 bucket pattern
 * Matches the naming pattern from TenantS3 construct
 */
export function getTenantBucketPattern(
  baseName: string,
  tenantId: string
): string {
  // Pattern: {baseName}-{environment}{hashedEnv:8}-tenant-{tenantId}
  return `${baseName}-${ENVIRONMENT}${HASHED_ENVIRONMENT}-tenant-${tenantId}`;
}

/**
 * Check if the tenant is the default tenant
 */
export function isDefaultTenant(tenantId: string): boolean {
  return tenantId === DEFAULT_TENANT_ID;
}

/**
 * Find the exact tenant bucket name using pattern matching
 * The bucket has a random GUID suffix, so we need to list and match
 */
export async function findTenantBucket(
  s3Client: S3Client,
  pattern: string
): Promise<string | null> {
  try {
    const { Buckets } = await s3Client.send(new ListBucketsCommand({}));

    // Create regex to match pattern with random GUID suffix
    const regex = new RegExp(`^${pattern}-[a-f0-9]+$`);

    const bucket = Buckets?.find((b) => regex.test(b.Name || ''));
    return bucket?.Name || null;
  } catch (error) {
    console.error('Failed to list S3 buckets:', error);
    return null;
  }
}

/**
 * Get the appropriate bucket name for a tenant operation
 * Returns default bucket for default tenant, tenant bucket for others
 */
export async function getTenantBucketName(
  event: APIGatewayProxyEvent,
  s3Client: S3Client,
  bucketType: 'chat' | 'docs' | 'analytics'
): Promise<string> {
  const tenantId = getTenantId(event);

  // Use default bucket for default tenant
  if (isDefaultTenant(tenantId)) {
    return DEFAULT_BUCKET_NAME;
  }

  // For tenant users, find the specific bucket
  const bucketPattern = getTenantBucketPattern(bucketType, tenantId);
  const bucketName = await findTenantBucket(s3Client, bucketPattern);

  // Fallback to default bucket if tenant bucket not found
  return bucketName || DEFAULT_BUCKET_NAME;
}

/**
 * Determine bucket base name from full bucket name
 * Helper function to extract base name for existing buckets
 */
export function determineBucketBaseName(bucketName: string): string {
  // Try to extract base name from bucket pattern
  // This is a heuristic for existing buckets that may not follow tenant pattern
  const parts = bucketName.split('-');

  // Common bucket base names
  const commonBases = ['chat', 'docs', 'analytics'];

  for (const base of commonBases) {
    if (bucketName.includes(base)) {
      return base;
    }
  }

  // Default to 'chat' for file uploads
  return 'chat';
}
