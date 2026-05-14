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
  // cdk.json の env 値（バケット名に組み込む）
  readonly env: string;
}

// バックアップを改ざん・削除不可で保管するためのバケット群。
// Object Lock Compliance モード 90 日のデフォルトリテンションを適用する。
// 本 construct は Phase 2 で作成のみ行い、メインスタックへの組込みは Phase 7 で実施する。
export class BackupLockedBuckets extends Construct {
  public readonly ddbExportBucket: Bucket;
  public readonly s3ReplicationBucket: Bucket;
  public readonly cognitoExportBucket: Bucket;

  constructor(scope: Construct, id: string, props: BackupLockedBucketsProps) {
    super(scope, id);

    const { env } = props;
    const region = cdk.Stack.of(this).region;

    // construct 全体に保護対象メタデータを付与（Aspect 除外用）
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
