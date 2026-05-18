import * as iam from 'aws-cdk-lib/aws-iam';
import { Bucket, CfnBucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3ReplicationProps {
  // Source buckets (FileBucket, etc.). Must be the concrete Bucket type (not IBucket)
  // because L1 override for replicationConfiguration requires access to node.defaultChild.
  readonly sourceBuckets: Bucket[];
  // Destination bucket (BackupLockedBuckets.s3ReplicationBucket).
  // IBucket is sufficient since only the ARN is referenced.
  readonly destinationBucket: IBucket;
}

// Construct that configures Same Region Replication (SRR) from FileBucket(s)
// to BackupLockedBuckets.s3ReplicationBucket.
//
// Design assumptions:
// - Source buckets have Versioning enabled (addressed in Phase 1)
// - Destination bucket has Object Lock Compliance with 90-day retention (addressed in Phase 2)
// - Delete markers are not replicated (to isolate the impact of accidental deletions)
// - Only new PUTs are targeted. Existing objects are handled separately via AWS S3 Batch Replication
//
// This construct is created in Phase 5; integration into the main stack (wiring FileBucket
// to s3ReplicationBucket) is done in Phase 7.
export class S3ReplicationConstruct extends Construct {
  public readonly replicationRole: iam.Role;

  constructor(scope: Construct, id: string, props: S3ReplicationProps) {
    super(scope, id);

    if (props.sourceBuckets.length === 0) {
      throw new Error(
        'S3ReplicationConstruct requires at least one source bucket.'
      );
    }

    // IAM Role that trusts the S3 service
    this.replicationRole = new iam.Role(this, 'ReplicationRole', {
      assumedBy: new iam.ServicePrincipal('s3.amazonaws.com'),
      description:
        'IAM Role for S3 cross-bucket replication to backup-locked bucket',
    });

    // Source-side read permissions: grant required permissions for each source bucket.
    // Object Lock retrieval actions (GetObjectVersionRetention / GetObjectLegalHold) are
    // required by AWS when Object Lock is enabled on the destination side.
    props.sourceBuckets.forEach((bucket) => {
      this.replicationRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetReplicationConfiguration',
            's3:ListBucket',
            's3:GetObjectVersionForReplication',
            's3:GetObjectVersionAcl',
            's3:GetObjectVersionTagging',
            's3:GetObjectVersionRetention',
            's3:GetObjectLegalHold',
          ],
          resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
        })
      );
    });

    // Destination-side write permissions
    this.replicationRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:ReplicateObject',
          's3:ReplicateTags',
          's3:ObjectOwnerOverrideToBucketOwner',
        ],
        resources: [`${props.destinationBucket.bucketArn}/*`],
      })
    );

    // Apply replicationConfiguration to each source bucket via L1 override.
    // Since the L2 API for replicationRules is not mature, the L1 (CfnBucket)
    // replicationConfiguration property is set directly.
    props.sourceBuckets.forEach((bucket, idx) => {
      const cfnBucket = bucket.node.defaultChild as CfnBucket;
      cfnBucket.replicationConfiguration = {
        role: this.replicationRole.roleArn,
        rules: [
          {
            id: `replicate-to-backup-locked-${idx}`,
            status: 'Enabled',
            priority: 1,
            // Empty filter to target all objects for replication
            filter: {},
            // Do not replicate delete markers (prevent accidental deletion impact from propagating to the destination)
            deleteMarkerReplication: { status: 'Disabled' },
            destination: {
              bucket: props.destinationBucket.bucketArn,
            },
          },
        ],
      };
    });
  }
}
