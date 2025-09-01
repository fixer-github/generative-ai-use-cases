import { isDefaultTenant, getTenantBucketNameByTenantId } from './tenantS3Utils';

const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME!;

/**
 * Determine the appropriate video bucket for a tenant during video generation
 * Returns shared temp bucket for default tenant, tenant-specific bucket for others
 */
export async function getVideoBucketForGeneration(
  tenantId: string,
  region: string
): Promise<string> {
  if (isDefaultTenant(tenantId)) {
    // Use shared temporary bucket for default tenant
    const videoBucketRegionMap = JSON.parse(
      process.env.VIDEO_BUCKET_REGION_MAP ?? '{}'
    );
    const outputBucket = videoBucketRegionMap[region];

    if (!outputBucket || outputBucket.length === 0) {
      throw new Error('Video tmp bucket is not defined for default tenant');
    }
    console.log(
      `Using shared video bucket for default tenant: ${outputBucket}`
    );
    return outputBucket;
  } else {
    // Use tenant-specific bucket for tenant users
    const outputBucket = await getTenantBucketNameByTenantId(tenantId, 'videos', DEFAULT_BUCKET_NAME);
    console.log(`Using tenant-specific video bucket: ${outputBucket}`);
    return outputBucket;
  }
}

/**
 * Determine video bucket configuration for copy operations
 * Returns different configurations for default vs tenant users
 */
export async function getVideoBucketsForCopy(
  tenantId: string,
  region: string,
  defaultBucket: string
): Promise<{
  srcBucket?: string;
  dstBucket: string;
  needsCopy: boolean;
}> {
  if (isDefaultTenant(tenantId)) {
    // For default tenant: copy from shared temp bucket to default bucket
    const videoBucketRegionMap = JSON.parse(
      process.env.VIDEO_BUCKET_REGION_MAP ?? '{}'
    );
    const srcBucket = videoBucketRegionMap[region];

    if (!srcBucket || srcBucket.length === 0) {
      throw new Error(`Video temp bucket not defined for region ${region}`);
    }

    console.log(
      `Default tenant - copying from temp bucket ${srcBucket} to default bucket ${defaultBucket}`
    );

    return {
      srcBucket,
      dstBucket: defaultBucket,
      needsCopy: true,
    };
  } else {
    // For tenant users: video already generated directly to tenant bucket, so just update status
    const dstBucket = await getTenantBucketNameByTenantId(tenantId, 'videos', DEFAULT_BUCKET_NAME);
    console.log(
      `Tenant user - video already in tenant bucket ${dstBucket}, marking as complete`
    );

    return {
      dstBucket,
      needsCopy: false,
    };
  }
}