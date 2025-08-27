import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { getTenantId } from './tenantUtils';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as crypto from 'crypto';

// Constants at file level
const ENVIRONMENT = process.env.ENVIRONMENT!;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;
const CDK_ACCOUNT_ID = process.env.CDK_ACCOUNT_ID || '';
const AWS_REGION = process.env.AWS_REGION || '';

/**
 * Generate tenant-specific S3 bucket pattern
 * Matches the naming pattern from TenantS3 construct
 */
export function getTenantBucketPattern(
  baseName: string,
  tenantId: string
): string {
  // Pattern: {baseName}-{environment}-tenant-{tenantId}
  return `${baseName}-${ENVIRONMENT}-tenant-${tenantId}`;
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
    console.log(`Searching for bucket with pattern: ${pattern}`);
    const { Buckets } = await s3Client.send(new ListBucketsCommand({}));

    // Create regex to match pattern with hash suffix (alphanumeric characters)
    // The TenantS3 construct generates SHA256 hash which includes letters and numbers
    const regex = new RegExp(`^${pattern}-[a-zA-Z0-9]+$`);

    const bucket = Buckets?.find((b) => regex.test(b.Name || ''));

    if (bucket) {
      console.log(`Found matching bucket: ${bucket.Name}`);
    } else {
      console.warn(`No bucket found matching pattern: ${pattern}`);
      console.log(`Available buckets: ${Buckets?.map(b => b.Name).join(', ')}`);
      console.log(`Regex pattern used: ^${pattern}-[a-zA-Z0-9]+$`);
    }

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
 * Get the appropriate bucket name for a tenant operation using tenant ID directly
 * Returns default bucket for default tenant, tenant bucket for others
 * Uses deterministic bucket name generation (no s3:ListAllMyBuckets permission needed)
 */
export async function getTenantBucketNameByTenantId(
  tenantId: string,
  s3Client: S3Client,
  bucketType: 'chat' | 'docs' | 'analytics'
): Promise<string> {
  // Use default bucket for default tenant
  if (isDefaultTenant(tenantId)) {
    return DEFAULT_BUCKET_NAME;
  }

  try {
    // For tenant users, generate the exact bucket name deterministically
    const bucketName = generateTenantBucketName(
      bucketType,
      ENVIRONMENT,
      tenantId,
      CDK_ACCOUNT_ID,
      AWS_REGION
    );
    
    console.log(`Generated deterministic tenant bucket name: ${bucketName}`);
    return bucketName;
  } catch (error) {
    console.error(`Error generating tenant bucket name for tenant ${tenantId}:`, error);
    console.error(`WARNING: Falling back to default bucket: ${DEFAULT_BUCKET_NAME}`);
    console.error(`This means tenant files will be uploaded to the default bucket instead of tenant-isolated bucket!`);
    console.error(`Tenant ID: ${tenantId}, Bucket type: ${bucketType}, Fallback bucket: ${DEFAULT_BUCKET_NAME}`);
    
    // Fallback to default bucket if generation fails
    return DEFAULT_BUCKET_NAME;
  }
}

/**
 * Determine bucket base name from full bucket name
 * Helper function to extract base name for existing buckets
 */
export function determineBucketBaseName(bucketname: string): string {
  // Common bucket base names
  const commonBases = ['chat', 'docs', 'analytics'];

  for (const base of commonBases) {
    if (bucketname.includes(base)) {
      return base;
    }
  }

  // Default to 'chat' for file uploads
  return 'chat';
}

/**
 * Generate a deterministic S3 bucket name using the same algorithm as TenantS3 construct
 * This eliminates the need for s3:ListAllMyBuckets permission
 * 
 * Format: {bucketBaseName}-{environment}-tenant-{tenantId}-{guidHash}
 */
export function generateTenantBucketName(
  bucketBaseName: string,
  environment: string,
  tenantId: string,
  accountId: string,
  region: string
): string {
  // AWS S3 bucket naming constraints
  const MAX_BUCKET_NAME_LENGTH = 63;
  const TENANT_PREFIX = 'tenant-';
  const SEPARATOR = '-';

  // Sanitize tenant ID for use in resource names (same as TenantS3 construct)
  const sanitizedTenantId = tenantId
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();

  // Calculate available space for GUID hash
  const baseLength = bucketBaseName.length +
                    SEPARATOR.length +
                    environment.length +
                    SEPARATOR.length +
                    TENANT_PREFIX.length +
                    sanitizedTenantId.length +
                    SEPARATOR.length;

  if (baseLength >= MAX_BUCKET_NAME_LENGTH) {
    throw new Error(
      `Bucket name base components too long: ${baseLength} characters. ` +
        `Consider shortening bucketBaseName, environment, or tenantId.`
    );
  }

  const remainingLength = MAX_BUCKET_NAME_LENGTH - baseLength;

  // Generate deterministic GUID hash for remaining space (same algorithm as TenantS3)
  const accountInfo = `${accountId || 'unknown'}-${region || 'unknown'}`;
  const hashInput = `${bucketBaseName}-${environment}-${sanitizedTenantId}-${accountInfo}`;
  const guidHash = generateHash(hashInput, remainingLength);

  console.log(`Bucket name generation debug:`, {
    bucketBaseName,
    environment,
    sanitizedTenantId,
    accountId: accountId || 'unknown',
    region: region || 'unknown',
    accountInfo,
    hashInput,
    remainingLength,
    guidHash
  });

  const bucketName = `${bucketBaseName}-${environment}-${TENANT_PREFIX}${sanitizedTenantId}-${guidHash}`;

  // Final validation
  if (bucketName.length > MAX_BUCKET_NAME_LENGTH) {
    throw new Error(
      `Generated bucket name exceeds maximum length: ${bucketName.length} > ${MAX_BUCKET_NAME_LENGTH}`
    );
  }

  // Validate S3 bucket naming rules
  if (!/^[a-z0-9-]+$/.test(bucketName)) {
    throw new Error(
      `Generated bucket name contains invalid characters: ${bucketName}`
    );
  }

  if (bucketName.startsWith('-') || bucketName.endsWith('-')) {
    throw new Error(
      `Generated bucket name cannot start or end with hyphen: ${bucketName}`
    );
  }

  return bucketName;
}

/**
 * Generate a hash of specified length (same algorithm as TenantS3)
 */
function generateHash(input: string, length: number): string {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, length);
}
