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
  // Accepts a variable number of tables (Main / Stats / (UseCaseBuilder)). In Phase 7,
  // 2 or 3 tables are passed depending on the useCaseBuilderEnabled || agentBuilderEnabled condition.
  readonly tables: dynamodb.ITable[];
  // Intended to inject BackupLockedBuckets.ddbExportBucket in Phase 7.
  // When not specified, a temporary bucket (no Object Lock, no Backup: Protected tag)
  // is created within this construct. Injecting an external bucket in Phase 7 makes
  // the temporary bucket unnecessary, and it will be naturally deleted by the Aspect's DESTROY policy.
  readonly exportBucket?: IBucket;
}

// Construct that uses DynamoDB's PITR (Point-In-Time Recovery) feature to export
// specified tables to S3 on a daily basis. Automatically triggered by an EventBridge Rule
// at JST 04:30 (UTC 19:30). Staggered from the Cognito Export (JST 00:00) to avoid
// API contention. In Phase 4, a temporary bucket is generated internally; in Phase 7,
// it is replaced with BackupLockedBuckets.ddbExportBucket (Object Lock Compliance 90 days).
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

    // DynamoDB ExportTableToPointInTime permission: scoped to the target table ARNs
    this.exportLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:ExportTableToPointInTime'],
        resources: tableArns,
      })
    );

    // S3 write permission: scoped to the ddb-export/* prefix.
    // The DynamoDB Export service performs PutObject with its own permissions rather than
    // Lambda's, but we grant equivalent PutObject permissions to the Lambda as well to
    // support future validation and auxiliary script execution.
    this.exportLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:PutObject', 's3:AbortMultipartUpload'],
        resources: [`${this.exportBucket.bucketArn}/ddb-export/*`],
      })
    );

    // EventBridge Rule: Daily at JST 04:30 (UTC 19:30)
    // Staggered from the Cognito Export (JST 00:00) to avoid DDB / Cognito API contention
    new events.Rule(this, 'DailyExportSchedule', {
      schedule: events.Schedule.cron({
        minute: '30',
        hour: '19',
      }),
      targets: [new targets.LambdaFunction(this.exportLambda)],
    });
  }

  // Temporary storage until replaced with an external bucket in Phase 7. Object Lock is not
  // applied (since it cannot be disabled once enabled). Backup: Protected metadata/tags are
  // also not attached, so this bucket is naturally deleted by cdk destroy after replacement in Phase 7.
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
