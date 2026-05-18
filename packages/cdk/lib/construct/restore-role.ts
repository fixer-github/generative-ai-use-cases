import { Duration, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface RestoreRoleProps {
  // Trust relationship that allows AssumeRole. As the confirmed Phase 6 Q1=a policy,
  // AccountPrincipal (with MFA required condition) is passed as an interim measure.
  // Replace this once the SSO role or similar is finalized.
  readonly trustedPrincipal: iam.IPrincipal;
  // DynamoDB tables to be restored (Main / Stats / (UseCaseBuilder)).
  // Injected as a variable-length array following the same Policy Beta as Phase 4;
  // in Phase 7, 3 tables are passed when UseCaseBuilder is enabled, 2 otherwise.
  readonly tables: dynamodb.ITable[];
  // The Cognito UserPool to be restored.
  readonly userPool: cognito.IUserPool;
  // Production S3 buckets to be restored (FileBucket, etc.). Includes write and delete permissions.
  readonly sourceBuckets: IBucket[];
  // Isolated backup buckets (under Object Lock Compliance). Only read access is granted;
  // write and delete are intentionally withheld (P-13, defense in depth).
  readonly backupBuckets: IBucket[];
}

// Construct that provides an IAM Role for performing backup restoration operations.
//
// Components:
// 1. Restoration operator Role (`role`)
//    - Grants least-privilege permissions across 5 areas: DynamoDB PITR / S3 / Cognito / CloudWatch Logs / isolated backup read
//    - maxSessionDuration: 4 hours
// 2. Cognito import service role (`cognitoImportRole`)
//    - Specified as the `cloud-watch-logs-role-arn` parameter when executing `CreateUserImportJob`
//    - Trusts cognito-idp.amazonaws.com and has only CloudWatch Logs write permissions
//
// Compliant with design document sections 6.1 (P-07) and 7.5 (P-13), and each restoration scenario in the restoration procedure manual.
export class RestoreRoleConstruct extends Construct {
  public readonly role: iam.Role;
  public readonly cognitoImportRole: iam.Role;

  constructor(scope: Construct, id: string, props: RestoreRoleProps) {
    super(scope, id);

    if (props.tables.length === 0) {
      throw new Error(
        'RestoreRoleConstruct requires at least one DynamoDB table.'
      );
    }
    if (props.sourceBuckets.length === 0) {
      throw new Error(
        'RestoreRoleConstruct requires at least one source S3 bucket.'
      );
    }
    if (props.backupBuckets.length === 0) {
      throw new Error(
        'RestoreRoleConstruct requires at least one backup S3 bucket.'
      );
    }

    this.role = new iam.Role(this, 'RestoreRole', {
      assumedBy: props.trustedPrincipal,
      maxSessionDuration: Duration.hours(4),
      description:
        'Role for backup restoration operations (DynamoDB PITR, S3, Cognito, etc.)',
    });

    const tableArns = props.tables.map((t) => t.tableArn);

    // (1) DynamoDB restore permissions: PITR restore, table info retrieval, scan/query, import.
    // Resources are scoped to the target table ARNs. GSI operations are not needed for the PITR restore API.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:RestoreTableToPointInTime',
          'dynamodb:RestoreTableFromBackup',
          'dynamodb:DescribeTable',
          'dynamodb:DescribeContinuousBackups',
          'dynamodb:DescribeBackup',
          'dynamodb:ListBackups',
          'dynamodb:ListTables',
          'dynamodb:Scan',
          'dynamodb:Query',
          'dynamodb:ImportTable',
          'dynamodb:DescribeImport',
        ],
        resources: tableArns,
      })
    );

    // (2) S3 production restore permissions: includes overwrite and delete for restoration. Scoped to production buckets only.
    const sourceBucketResources = props.sourceBuckets.flatMap((bucket) => [
      bucket.bucketArn,
      `${bucket.bucketArn}/*`,
    ]);
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:PutObject',
          's3:DeleteObject',
          's3:DeleteObjectVersion',
          's3:ListBucket',
          's3:ListBucketVersions',
          's3:GetBucketVersioning',
        ],
        resources: sourceBucketResources,
      })
    );

    // (3) Cognito restore permissions: user import job creation, execution, status retrieval, and user operations
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:CreateUserImportJob',
          'cognito-idp:StartUserImportJob',
          'cognito-idp:StopUserImportJob',
          'cognito-idp:DescribeUserImportJob',
          'cognito-idp:ListUserImportJobs',
          'cognito-idp:GetCSVHeader',
          'cognito-idp:ListUsers',
          'cognito-idp:ListGroups',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // (4) CloudWatch Logs read permissions: for investigation and troubleshooting during restoration.
    // Many CloudWatch Logs API operations do not work with resource ARN scoping,
    // so resources: ['*'] is used in compliance with the design document (preparation manual section 6.1.3).
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:DescribeLogGroups',
          'logs:DescribeLogStreams',
          'logs:GetLogEvents',
          'logs:FilterLogEvents',
          'logs:StartQuery',
          'logs:GetQueryResults',
        ],
        resources: ['*'],
      })
    );

    // (5) Isolated backup bucket read permissions (P-13): write and delete are not granted.
    // Object Lock status retrieval is included to allow verifying lock expiration before restoration.
    const backupBucketResources = props.backupBuckets.flatMap((bucket) => [
      bucket.bucketArn,
      `${bucket.bucketArn}/*`,
    ]);
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:GetObjectRetention',
          's3:GetObjectLegalHold',
          's3:GetObjectTagging',
          's3:GetObjectVersionTagging',
          's3:ListBucket',
          's3:ListBucketVersions',
          's3:GetBucketObjectLockConfiguration',
          's3:GetBucketVersioning',
        ],
        resources: backupBucketResources,
      })
    );

    // Cognito import service role: passed as an argument to CreateUserImportJob.
    // Only CloudWatch Logs write permissions are granted. The Cognito service
    // assumes this role to write import progress logs to CloudWatch.
    this.cognitoImportRole = new iam.Role(this, 'CognitoImportRole', {
      assumedBy: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      description:
        'Service role used by Cognito CreateUserImportJob to write import progress logs to CloudWatch',
    });

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    this.cognitoImportRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:DescribeLogGroups',
          'logs:DescribeLogStreams',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${region}:${account}:log-group:/aws/cognito/*`,
        ],
      })
    );
  }
}
