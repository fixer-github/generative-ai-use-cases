import { Construct } from 'constructs';
import {
  Role,
  PolicyStatement,
  Effect,
  WebIdentityPrincipal,
  CfnRole,
} from 'aws-cdk-lib/aws-iam';
import { Stack, Fn, CfnJson } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export interface MultiTenantRoleProps {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly region: string;
  readonly account: string;
  readonly env?: string;
}

export class MultiTenantRole extends Construct {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: MultiTenantRoleProps) {
    super(scope, id);

    // Create web identity principal for Cognito without conditions
    // Conditions will be added via escape hatch to avoid token resolution issues
    const principal = new WebIdentityPrincipal(
      `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`
    );

    // Create the single role for multi-tenant access with tag-based ABAC
    this.role = new Role(this, 'MultiTenantAccessRole', {
      roleName: `${Stack.of(this).stackName}-MultiTenantAccessRole`,
      assumedBy: principal,
      description:
        'Single role for multi-tenant resource access with tag-based ABAC',
    });

    // Note: Session tag mapping for JWT claims must be configured in Cognito
    // Pre-Token Generation trigger to add the tenant ID to the JWT claims

    // Add S3 access policy for all tenant buckets
    // Since AssumeRoleWithWebIdentity doesn't support SessionTags, we allow access to all tenant buckets
    // Security is enforced at the application level by only calling AssumeRole for users with tenant ID
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'S3TenantAccess',
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          // Bucket-level permissions (stack-specific, all tenant buckets)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-*`,
          // Object-level permissions (stack-specific, all tenant buckets)
          `arn:aws:s3:::generativeaiusecasesstack${props.env || ''}-*-tenant-*/*`,
        ],
      })
    );

    // Add DynamoDB access policy for all tenant tables
    // Since AssumeRoleWithWebIdentity doesn't support SessionTags, we allow access to all tenant tables
    // Security is enforced at the application level by only calling AssumeRole for users with tenant ID
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'DynamoDBTenantAccess',
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:DescribeTable',
          'dynamodb:DescribeTimeToLive',
        ],
        resources: [
          // Allow access to all tenant tables - security enforced by only assuming role for correct tenant
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*`,
          `arn:aws:dynamodb:${props.region}:${props.account}:table/*-tenant-*/index/*`,
        ],
      })
    );

    // Note: Cross-tenant security is enforced at application level
    // Only users with valid tenant_id in JWT can assume this role
    // Repository layer ensures users only access tables matching their tenant_id

    // Add CloudWatch Logs access for debugging
    this.role.addToPolicy(
      new PolicyStatement({
        sid: 'CloudWatchLogsAccess',
        effect: Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${props.region}:${props.account}:log-group:/aws/lambda/*`,
        ],
      })
    );

    // ===== IAMロールの信頼ポリシー（Trust Policy）の設定 =====
    // これは「誰がこのロールを引き受けることができるか」を定義する重要な設定です
    
    // CfnJsonを使用して動的な値（トークン）をキーとして含むConditionを作成
    // CDKでは、デプロイ時に解決される値（userPoolIdなど）をオブジェクトのキーとして
    // 直接使用できないため、CfnJsonを介して処理する必要がある
    const trustCondition = new CfnJson(this, 'TrustCondition', {
      value: {
        // aud（audience）クレームがこのアプリのクライアントIDと一致することを要求
        // これにより、正しいCognitoアプリケーションからのトークンのみを受け入れる
        [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]: 
          props.userPoolClient.userPoolClientId,
      },
    });
    
    // CDKで作成したロールオブジェクトから、CloudFormationレベルのロールオブジェクトを取得
    // （信頼ポリシーを直接設定するためにL1コンストラクト（CfnRole）にアクセス）
    const cfnRole = this.role.node.defaultChild as CfnRole;
    
    // AssumeRolePolicyDocument = このロールの「信頼関係」を定義
    // つまり「このロールを誰が使えるか」のルールを設定
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',  // IAMポリシー言語のバージョン（固定値）
      Statement: [
        {
          // このステートメントで「許可」を設定
          Effect: 'Allow',
          
          // Principal = 「誰に」許可するかを指定
          // Federated = 外部IDプロバイダー（この場合はCognito）を指定
          Principal: {
            // Cognito User Poolを信頼する設定
            // これにより、このUser Poolで認証されたユーザーがロールを引き受け可能になる
            Federated: `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`,
          },
          
          // Action = 「何を」許可するかを指定
          // AssumeRoleWithWebIdentity = CognitoのJWTトークンを使ってロールを引き受ける操作
          Action: 'sts:AssumeRoleWithWebIdentity',
          
          // Condition = 追加の条件（セキュリティ強化）
          Condition: {
            // StringEquals = 文字列の完全一致を要求
            // CfnJsonで作成した動的なConditionを参照
            StringEquals: trustCondition,
          },
        },
      ],
    };
  }
}
