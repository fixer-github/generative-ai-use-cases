import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectLockRetention,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import {
  BACKUP_PROTECTED_TAG,
  BACKUP_PROTECTED_METADATA_KEY,
  BACKUP_PROTECTED_METADATA_VALUE,
} from '../aspect/deletion-policy-setter';

export interface BackupLockedBucketsProps {
  // The env value from cdk.json (embedded in bucket names)
  readonly env: string;
}

// Bucket group for storing backups in a tamper-proof, undeletable manner.
// Applies a default retention of 90 days in Object Lock Compliance mode.
// This construct is created in Phase 2; integration into the main stack is done in Phase 7.
export class BackupLockedBuckets extends Construct {
  public readonly ddbExportBucket: Bucket;
  public readonly s3ReplicationBucket: Bucket;
  public readonly cognitoExportBucket: Bucket;

  constructor(scope: Construct, id: string, props: BackupLockedBucketsProps) {
    super(scope, id);

    const { env } = props;
    const region = cdk.Stack.of(this).region;

    // Attach backup-protected metadata to the entire construct (for Aspect exclusion)
    this.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );

    this.ddbExportBucket = this.createLockedBucket(
      'DdbBucket',
      `genu-gaixer-${env}-backup-locked-ddb-${region}`
    );
    this.s3ReplicationBucket = this.createLockedBucket(
      'S3Bucket',
      `genu-gaixer-${env}-backup-locked-s3-${region}`
    );
    this.cognitoExportBucket = this.createLockedBucket(
      'CognitoBucket',
      `genu-gaixer-${env}-backup-locked-cognito-${region}`
    );
  }

  private createLockedBucket(id: string, bucketName: string): Bucket {
    const bucket = new Bucket(this, id, {
      bucketName,
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      objectLockEnabled: true,
      objectLockDefaultRetention: ObjectLockRetention.compliance(
        Duration.days(90)
      ),
    });

    cdk.Tags.of(bucket).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );

    return bucket;
  }
}
