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
  // Intended to inject BackupLockedBuckets.cognitoExportBucket in Phase 7.
  // When not specified, a temporary bucket (no Object Lock, no Backup: Protected tag)
  // is created within this construct. Injecting an external bucket in Phase 7 makes
  // the temporary bucket unnecessary, and it will be naturally deleted by the Aspect's DESTROY policy.
  readonly exportBucket?: IBucket;
}

// Construct that exports all Cognito UserPool users, groups, and group membership
// mappings to S3 on a daily basis. Automatically triggered by an EventBridge Rule at
// JST 00:00 (UTC 15:00). In Phase 3, a temporary bucket is generated internally;
// in Phase 7, it is replaced with BackupLockedBuckets.cognitoExportBucket (Object Lock Compliance 90 days).
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

    // Cognito least-privilege: scoped to the target UserPool ARN
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

    // S3 PutObject permission: scoped to the target bucket
    this.exportBucket.grantPut(this.exportLambda);

    // EventBridge Rule: Daily at JST 00:00 (UTC 15:00 = JST 24:00 = next day 00:00)
    new events.Rule(this, 'DailyExportSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '15',
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
