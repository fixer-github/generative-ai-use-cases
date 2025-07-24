# AssumeRoleWithWebIdentityを使用したテナントIAMロール

JWTトークンを使用したマルチテナントアクセス用のシンプルなIAMロール作成。

## クイックスタート

### CDKコンテキストを使用（推奨）

```bash
# packages/cdkディレクトリから実行
cd packages/cdk

# 基本的な使用方法
npx cdk deploy TenantIamRoleStack \
  -c tenantIamRoleEnabled=true \
  -c tenantIdentityProviderArn=arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXXX \
  -c tenantAudience=your-client-id

# カスタムロール名を指定
npx cdk deploy TenantIamRoleStack \
  -c tenantIamRoleEnabled=true \
  -c tenantIdentityProviderArn=arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXXX \
  -c tenantAudience=your-client-id \
  -c tenantRoleName=MyTenantRole

# 全てのオプションを指定
npx cdk deploy TenantIamRoleStack \
  -c tenantIamRoleEnabled=true \
  -c tenantIdentityProviderArn=arn:aws:cognito-idp:ap-northeast-1:123456789012:userpool/ap-northeast-1_ABC123 \
  -c tenantAudience=my-client-id \
  -c tenantRoleName=MyTenantRole \
  -c tenantIdClaim=custom:tenant_id
```

### cdk.jsonに設定を追加

永続的な設定の場合は、`packages/cdk/cdk.json`の`context`セクションに追加：

```json
{
  "context": {
    "tenantIamRoleEnabled": true,
    "tenantIdentityProviderArn": "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXXX",
    "tenantAudience": "your-client-id",
    "tenantRoleName": "MyTenantRole",
    "tenantIdClaim": "custom:tenant_id"
  }
}
```

その後、単純に実行：
```bash
npx cdk deploy TenantIamRoleStack
```

## CDKの使用方法

### 基本的なロール作成

```typescript
import { TenantIamRole } from './construct/tenant-iam-role';

const role = new TenantIamRole(this, 'MyTenantRole', {
  identityProviderArn: 'arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-id',
  audience: 'client-id',
  tenantIdClaim: 'custom:tenant_id', // オプション、デフォルト値
  roleName: 'MyTenantAccessRole', // オプション
  maxSessionDuration: cdk.Duration.hours(2), // オプション、デフォルトは1時間
});
```

### ポリシーの追加

```typescript
// カスタムポリシーステートメントの追加
role.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['s3:ListBucket'],
  resources: ['arn:aws:s3:::my-bucket'],
}));

// マネージドポリシーのアタッチ
role.attachManagedPolicy(
  iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess')
);

// 一般的なパターン用のヘルパーメソッドの使用
const dynamoStatement = role.createDynamoDbPolicyStatement(
  'arn:aws:dynamodb:us-east-1:123456789012:table/MyTable'
);
role.addToPolicy(dynamoStatement);

const s3Statements = role.createS3PolicyStatement(
  'arn:aws:s3:::my-bucket'
);
s3Statements.forEach(stmt => role.addToPolicy(stmt));
```

## 信頼ポリシー

ロールは自動的に以下のような信頼ポリシーを作成します：

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:cognito-idp:region:account:userpool/pool-id"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "cognito-idp.region.amazonaws.com/pool-id:aud": "client-id"
      }
    }
  }]
}
```

## クライアントでの使用方法

```javascript
// IDプロバイダーからJWTトークンを取得
const idToken = await getIdToken();

// AWS認証情報と交換
const sts = new AWS.STS();
const credentials = await sts.assumeRoleWithWebIdentity({
  RoleArn: 'arn:aws:iam::123456789012:role/TenantRole',
  RoleSessionName: `tenant-${tenantId}`,
  WebIdentityToken: idToken,
  DurationSeconds: 3600,
}).promise();

// 認証情報を使用
const s3 = new AWS.S3({
  credentials: {
    accessKeyId: credentials.Credentials.AccessKeyId,
    secretAccessKey: credentials.Credentials.SecretAccessKey,
    sessionToken: credentials.Credentials.SessionToken,
  },
});
```

## スクリプトオプション

```bash
./scripts/create-tenant-iam-role.sh [オプション]

オプション:
  -p, --provider-arn ARN       IDプロバイダーARN（必須）
  -a, --audience ID            オーディエンス/クライアントID（必須）
  -c, --claim NAME             テナントIDクレーム名（デフォルト: custom:tenant_id）
  -n, --role-name NAME         IAMロール名（オプション）
  -s, --stack-name NAME        CloudFormationスタック名（デフォルト: TenantIamRoleStack）
  -r, --region REGION          AWSリージョン（デフォルト: 現在のリージョン）
  -h, --help                   ヘルプメッセージを表示
```

## 出力

デプロイ後、スタックは以下を出力します：
- **RoleArn**: 作成されたIAMロールのARN
- **RoleName**: 作成されたIAMロールの名前

スクリプトは設定の詳細を含む`tenant-iam-role-config.json`も作成します。