import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { VideoJob } from 'generative-ai-use-cases';
import { updateJobStatus } from './repositoryVideoJob';
import {
  getTenantBucketNameByTenantId,
  isDefaultTenant,
} from './utils/tenantS3Utils';
import { createTenantS3ClientForBackgroundJob } from './utils/tenantS3Client';

// Extend VideoJob to include tenantId for tenant-specific processing
type VideoJobWithTenant = VideoJob & {
  tenantId?: string;
};

export interface CopyVideoJobParams {
  job: VideoJobWithTenant;
}

const BUCKET_NAME: string = process.env.BUCKET_NAME!;
const videoBucketRegionMap = JSON.parse(
  process.env.VIDEO_BUCKET_REGION_MAP ?? '{}'
);

const copyAndDeleteObject = async (
  jobId: string,
  srcBucket: string,
  srcRegion: string,
  dstBucket: string,
  dstRegion: string,
  tenantId?: string
) => {
  const srcS3 = new S3Client({ region: srcRegion });
  const dstS3 = await createTenantS3ClientForBackgroundJob(
    tenantId || 'default',
    dstRegion
  );

  const { Body, ContentType, ContentLength } = await srcS3.send(
    new GetObjectCommand({
      Bucket: srcBucket,
      Key: `${jobId}/output.mp4`,
    })
  );

  const chunks = [];
  for await (const chunk of Body as Readable) {
    chunks.push(chunk);
  }
  const fileBuffer = Buffer.concat(chunks);

  await dstS3.send(
    new PutObjectCommand({
      Bucket: dstBucket,
      Key: `${jobId}/output.mp4`,
      Body: fileBuffer,
      ContentType,
      ContentLength,
    })
  );

  const listRes = await srcS3.send(
    new ListObjectsV2Command({
      Bucket: srcBucket,
      Prefix: jobId,
    })
  );

  const objects = listRes.Contents?.map((object) => ({
    Key: object.Key,
  }));

  await srcS3.send(
    new DeleteObjectsCommand({
      Bucket: srcBucket,
      Delete: {
        Objects: objects,
      },
    })
  );
};

export const handler = async (event: CopyVideoJobParams): Promise<void> => {
  const job = event.job;
  const jobId = job.jobId;
  const dstRegion = process.env.AWS_DEFAULT_REGION!;

  // Determine source and destination buckets based on tenant
  const tenantId = job.tenantId; // Tenant ID is stored in job

  let srcBucket: string;
  let dstBucket: string;

  if (!tenantId || isDefaultTenant(tenantId)) {
    // For default tenant: copy from shared temp bucket to default bucket
    srcBucket = videoBucketRegionMap[job.region];
    dstBucket = BUCKET_NAME;
    console.log(
      `Default tenant - copying from temp bucket ${srcBucket} to default bucket ${dstBucket}`
    );

    if (!srcBucket || srcBucket.length === 0) {
      throw new Error(`Video temp bucket not defined for region ${job.region}`);
    }
  } else {
    // For tenant users: video already generated directly to tenant bucket, so just update status
    dstBucket = await getTenantBucketNameByTenantId(tenantId, 'videos');
    console.log(
      `Tenant user - video already in tenant bucket ${dstBucket}, marking as complete`
    );

    // No copying needed for tenant users since video was generated directly to tenant bucket
    await updateJobStatus(job, 'Completed');
    return;
  }

  console.log(
    `Copying video from ${srcBucket} (${job.region}) to ${dstBucket} (${dstRegion})`
  );

  try {
    await copyAndDeleteObject(
      jobId,
      srcBucket,
      job.region,
      dstBucket,
      dstRegion,
      tenantId
    );

    await updateJobStatus(job, 'Completed');
  } catch (error) {
    console.error(error);
    await updateJobStatus(job, 'Failed');
  }
};
