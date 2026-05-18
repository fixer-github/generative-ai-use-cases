import { Duration, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface RestoreRoleProps {
  // AssumeRole を許可する信頼関係。Phase 6 の Q1=a 確定方針として、
  // 暫定で AccountPrincipal（MFA 必須条件付き）を渡す想定。SSO ロール等が
  // 確定したらここを差替える。
  readonly trustedPrincipal: iam.IPrincipal;
  // 復元対象の DynamoDB テーブル群（Main / Stats / (UseCaseBuilder)）。
  // Phase 4 と同じ方針 β で可変長注入し、Phase 7 で UseCaseBuilder 有効時に
  // 3 件、無効時に 2 件を渡す。
  readonly tables: dynamodb.ITable[];
  // 復元対象の Cognito UserPool。
  readonly userPool: cognito.IUserPool;
  // 復元対象の本番 S3 バケット群（FileBucket 等）。書込・削除を含む。
  readonly sourceBuckets: IBucket[];
  // 分離保管バケット群（Object Lock Compliance 配下）。読取のみ付与し、
  // 書込・削除は意図的に付与しない（P-13、多層防御）。
  readonly backupBuckets: IBucket[];
}

// バックアップからの復元作業を実施するための IAM Role を提供する Construct。
//
// 構成：
// 1. 復元実施者用 Role（`role`）
//    - DynamoDB PITR / S3 / Cognito / CloudWatch Logs / 分離保管読取の 5 系権限を最小範囲で付与
//    - maxSessionDuration: 4 時間
// 2. Cognito インポート用サービスロール（`cognitoImportRole`）
//    - `CreateUserImportJob` 実行時の `cloud-watch-logs-role-arn` パラメータに指定する
//    - cognito-idp.amazonaws.com を信頼し、CloudWatch Logs 書込権限のみを持つ
//
// 設計書の §6.1（P-07）と §7.5（P-13）、および復元手順書の各復元シナリオに準拠。
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

    // ① DynamoDB 復元権限：PITR 復元・テーブル情報取得・スキャン／クエリ・Import
    // resources は対象テーブル ARN に限定。GSI 操作は PITR 復元 API では不要。
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

    // ② S3 本番復元権限：復元時の上書き・削除を含む。範囲は本番バケットのみ。
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

    // ③ Cognito 復元権限：ユーザーインポートジョブ作成・実行・状態取得・ユーザー操作
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

    // ④ CloudWatch Logs 参照権限：復元時の調査・トラブルシュート用
    // CloudWatch Logs API は resource ARN 指定で動作しない操作が多いため、
    // 設計書（準備手順書 §6.1.3）準拠で resources: ['*'] を採用。
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

    // ⑤ 分離保管バケット読取権限（P-13）：書込・削除は付与しない。
    // Object Lock 状態取得も含めることで、復元前にロック有効期限の確認が可能。
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

    // Cognito インポート用サービスロール：CreateUserImportJob の引数として渡す
    // CloudWatch Logs への書込権限のみを付与する。Cognito サービスが
    // この Role を AssumeRole してインポート進捗ログを CloudWatch に出力する。
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
