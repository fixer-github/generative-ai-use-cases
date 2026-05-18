import * as iam from 'aws-cdk-lib/aws-iam';
import { Bucket, CfnBucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3ReplicationProps {
  // 複製元バケット群（FileBucket 等）。L1 オーバーライドで replicationConfiguration を
  // 付与する都合上、concrete な Bucket 型で受け取る必要がある（node.defaultChild が必要）。
  readonly sourceBuckets: Bucket[];
  // 複製先バケット（BackupLockedBuckets.s3ReplicationBucket）。
  // ARN のみ参照するため IBucket で受ければ十分。
  readonly destinationBucket: IBucket;
}

// FileBucket（複数対応）から BackupLockedBuckets.s3ReplicationBucket へ
// 同一リージョン内 SRR（Same Region Replication）を構成する Construct。
//
// 設計上の前提：
// - 複製元バケットは Versioning 有効（Phase 1 で対応済）
// - 複製先バケットは Object Lock Compliance 90 日（Phase 2 で対応済）
// - 削除マーカーは複製しない（誤削除の影響遮断）
// - 新規 PUT のみが対象。既存オブジェクトは AWS S3 Batch Replication で別途運用
//
// 本 construct は Phase 5 で作成のみ行い、メインスタックへの組込み（FileBucket と
// s3ReplicationBucket の配線）は Phase 7 で実施する。
export class S3ReplicationConstruct extends Construct {
  public readonly replicationRole: iam.Role;

  constructor(scope: Construct, id: string, props: S3ReplicationProps) {
    super(scope, id);

    if (props.sourceBuckets.length === 0) {
      throw new Error(
        'S3ReplicationConstruct requires at least one source bucket.'
      );
    }

    // S3 サービスを信頼する IAM Role
    this.replicationRole = new iam.Role(this, 'ReplicationRole', {
      assumedBy: new iam.ServicePrincipal('s3.amazonaws.com'),
      description:
        'IAM Role for S3 cross-bucket replication to backup-locked bucket',
    });

    // ソース側読取権限：各 source bucket に対して必要な権限を付与
    // Object Lock 取得系（GetObjectVersionRetention / GetObjectLegalHold）は、
    // 宛先側で Object Lock が有効なため AWS 仕様上必要となる。
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

    // 宛先側書込権限
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

    // L1 オーバーライドで各 source bucket に replicationConfiguration を付与
    // L2 API での replicationRules が成熟していないため、L1（CfnBucket）の
    // replicationConfiguration プロパティを直接設定する。
    props.sourceBuckets.forEach((bucket, idx) => {
      const cfnBucket = bucket.node.defaultChild as CfnBucket;
      cfnBucket.replicationConfiguration = {
        role: this.replicationRole.roleArn,
        rules: [
          {
            id: `replicate-to-backup-locked-${idx}`,
            status: 'Enabled',
            priority: 1,
            // 空 filter で全オブジェクトをレプリ対象に
            filter: {},
            // 削除マーカーは複製しない（誤削除の影響を宛先に伝播させない）
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
