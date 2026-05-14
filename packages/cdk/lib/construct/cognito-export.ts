import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
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

export interface CognitoExportProps {
  readonly userPool: cognito.IUserPool;
  // Phase 7 で BackupLockedBuckets.cognitoExportBucket を注入予定。
  // 未指定時は本 construct 内で仮バケット（Object Lock なし、Backup: Protected
  // 付与なし）を作成する。Phase 7 で外部バケットを注入することで、仮バケットは
  // 不要となり Aspect の DESTROY 適用で自然削除される。
  readonly exportBucket?: IBucket;
}

// Cognito UserPool の全ユーザー・グループ・グループ所属マップを日次で
// S3 にエクスポートする Construct。EventBridge Rule により JST 00:00（UTC 15:00）に
// 自動起動される。Phase 3 では仮バケットを内部生成し、Phase 7 で
// BackupLockedBuckets.cognitoExportBucket（Object Lock Compliance 90 日）に差し替える。
export class CognitoExportConstruct extends Construct {
  public readonly exportBucket: IBucket;
  public readonly exportLambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: CognitoExportProps) {
    super(scope, id);

    this.exportBucket = props.exportBucket ?? this.createFallbackBucket();

    this.exportLambda = new NodejsFunction(this, 'ExportFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/cognitoExport.ts',
      timeout: Duration.minutes(5),
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        EXPORT_BUCKET_NAME: this.exportBucket.bucketName,
      },
    });

    // Cognito 最小権限：対象 UserPool ARN に限定
    this.exportLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:ListGroups',
          'cognito-idp:ListUsersInGroup',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // S3 PutObject 権限：対象バケットに限定
    this.exportBucket.grantPut(this.exportLambda);

    // EventBridge Rule：JST 00:00 日次（UTC 15:00 = JST 24:00 = 翌日 00:00）
    new events.Rule(this, 'DailyExportSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '15',
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
