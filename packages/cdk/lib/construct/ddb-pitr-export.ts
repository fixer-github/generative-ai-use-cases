import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface DdbPitrExportProps {
  // Main / Stats / (UseCaseBuilder) を可変長で受取。Phase 7 で
  // useCaseBuilderEnabled || agentBuilderEnabled の条件分岐により 2〜3 件を渡す想定。
  readonly tables: dynamodb.ITable[];
  // Phase 7 で BackupLockedBuckets.ddbExportBucket を注入予定。
  // 未指定時は本 construct 内で仮バケット（Object Lock なし、Backup: Protected
  // 付与なし）を作成する。Phase 7 で外部バケットを注入することで、仮バケットは
  // 不要となり Aspect の DESTROY 適用で自然削除される。
  readonly exportBucket?: IBucket;
}

// DynamoDB の PITR（Point-In-Time Recovery）機能を使い、指定されたテーブル群を
// 日次で S3 にエクスポートする Construct。EventBridge Rule により JST 04:30
// （UTC 19:30）に自動起動される。Cognito Export（JST 00:00）と時間をずらして
// API 競合を回避している。Phase 4 では仮バケットを内部生成し、Phase 7 で
// BackupLockedBuckets.ddbExportBucket（Object Lock Compliance 90 日）に差し替える。
export class DdbPitrExportConstruct extends Construct {
  public readonly exportBucket: IBucket;
  public readonly exportLambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: DdbPitrExportProps) {
    super(scope, id);

    if (props.tables.length === 0) {
      throw new Error(
        'DdbPitrExportConstruct requires at least one table to export.'
      );
    }

    this.exportBucket = props.exportBucket ?? this.createFallbackBucket();

    const tableArns = props.tables.map((t) => t.tableArn);

    this.exportLambda = new NodejsFunction(this, 'ExportFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/ddbPitrExport.ts',
      timeout: Duration.minutes(5),
      environment: {
        TABLE_ARNS: tableArns.join(','),
        EXPORT_BUCKET_NAME: this.exportBucket.bucketName,
      },
    });

    // DynamoDB ExportTableToPointInTime 権限：対象テーブル ARN に限定
    this.exportLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:ExportTableToPointInTime'],
        resources: tableArns,
      })
    );

    // S3 書込権限：ddb-export/* プレフィックスに限定
    // DynamoDB Export サービスは Lambda の権限ではなく export サービス自身が
    // PutObject を実行するが、Lambda 側でも grantPut 相当を付与しておくことで
    // 将来の検証・補助スクリプト実行に備える。
    this.exportLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:PutObject', 's3:AbortMultipartUpload'],
        resources: [`${this.exportBucket.bucketArn}/ddb-export/*`],
      })
    );

    // EventBridge Rule：JST 04:30 日次（UTC 19:30）
    // Cognito Export（JST 00:00）と時間をずらして DDB / Cognito API の競合を回避
    new events.Rule(this, 'DailyExportSchedule', {
      schedule: events.Schedule.cron({
        minute: '30',
        hour: '19',
      }),
      targets: [new targets.LambdaFunction(this.exportLambda)],
    });
  }

  // Phase 7 で外部バケットに差し替えるまでの暫定保管先。Object Lock は適用しない
  // （後から解除不可のため）。Backup: Protected メタデータ／タグも付与せず、
  // Phase 7 で本物に差し替えた後の cdk destroy で自然削除されるようにする。
  private createFallbackBucket(): Bucket {
    return new Bucket(this, 'FallbackExportBucket', {
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
    });
  }
}
