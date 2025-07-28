# STS AssumeRoleWithWebIdentity 使用ガイド

## 概要

STS AssumeRoleWithWebIdentity機能は、Cognitoトークン（テナントIDを含む）を一時的なAWSクレデンシャルに変換し、マルチテナント環境でのセキュリティとテナント分離を実現します。

## 認証フローの詳細

### 1. 全体的なフロー

```
ユーザー認証 → Cognito → JWT（tenant_id含む） → STS AssumeRoleWithWebIdentity → 一時クレデンシャル → AWS リソースアクセス
```

### 2. ステップごとの詳細

#### ステップ1: Cognitoでユーザー認証
```typescript
// ユーザーがログイン
const session = await fetchAuthSession();
const idToken = session.tokens?.idToken;
```

#### ステップ2: JWTトークンの構造
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "custom:tenant_id": "tenant-123",  // カスタム属性としてテナントID
  "https://aws.amazon.com/tags": {
    "principal_tags": {
      "TenantID": ["tenant-123"]      // IAMポリシーで参照可能
    }
  }
}
```

#### ステップ3: STSでJWTを一時クレデンシャルに変換
```typescript
// JWTからテナントIDを抽出
const payload = session.tokens?.idToken?.payload;
const tenantId = payload?.['custom:tenant_id'] as string;

// STSを呼び出して一時クレデンシャルを取得
const stsClient = new STSClient({});
const command = new AssumeRoleWithWebIdentityCommand({
  RoleArn: "arn:aws:iam::123456789012:role/TenantAccessRole",
  RoleSessionName: `tenant-${tenantId}-session`,
  WebIdentityToken: idToken,  // テナントIDを含むJWT
});

const response = await stsClient.send(command);
const credentials = {
  accessKeyId: response.Credentials.AccessKeyId,
  secretAccessKey: response.Credentials.SecretAccessKey,
  sessionToken: response.Credentials.SessionToken,
  expiration: response.Credentials.Expiration
};
```

#### ステップ4: 一時クレデンシャルでAWSリソースにアクセス
```typescript
// テナント固有のDynamoDBテーブルにアクセス
const dynamoClient = new DynamoDBClient({
  credentials: {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken
  }
});

// tenant-123のデータのみアクセス可能
const result = await dynamoClient.send(new GetItemCommand({
  TableName: 'ChatHistory-tenant-123',  // IAMポリシーで制限
  Key: { id: { S: 'item-id' } }
}));
```

## IAMロールの設定

### 重要: セッションタグの仕組み
AssumeRoleWithWebIdentityでは、セッションタグはAPIパラメータとして渡すことができません。代わりに、**JWTトークン内に埋め込まれている必要があります**。これが通常のAssumeRoleとの大きな違いです。

### 単一ロールでマルチテナント対応
1つのIAMロールで全てのテナントに対応できます。各テナントのセッションは、JWTクレームから取得したテナントIDに基づいて自動的に分離されます。

### 信頼ポリシー（Trust Policy）
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:cognito-identity:region:account:identitypool/pool-id"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "cognito-identity.amazonaws.com:aud": "identity-pool-id"
      }
    }
  }]
}
```

### アクセス許可ポリシー（Permissions Policy）
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:*"],
    "Resource": [
      "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}",
      "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}/index/*"
    ]
  }]
}
```

`${aws:PrincipalTag/TenantID}`は実行時に評価され、JWTから取得したテナントIDに置き換えられます。

## CDKでのデプロイ

### 自動作成（推奨）
`enableStsAssumeRole`をtrueに設定すると、共通スタックデプロイ時に自動的にマルチテナント用IAMロールが作成されます：

```json
// cdk.json
{
  "context": {
    "enableStsAssumeRole": true
    // tenantRoleArnを指定しない場合、自動的にロールが作成されます
  }
}
```

```bash
# 共通スタックをデプロイ（IAMロールも自動作成）
npx cdk deploy GenerativeAiUseCasesStack
```

### 手動作成（高度な設定が必要な場合）
独自のIAMポリシーが必要な場合は、別途ロールを作成して指定できます：

```json
// cdk.json
{
  "context": {
    "enableStsAssumeRole": true,
    "tenantRoleArn": "arn:aws:iam::123456789012:role/CustomTenantRole"
  }
}
```

## フロントエンドでの実装

### useStsフックの使用
```typescript
import { useSts } from './hooks/useSts';

function TenantDashboard() {
  const { assumeRole, credentials, isLoading } = useSts({
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefresh: true,  // 期限切れ前に自動更新
  });

  useEffect(() => {
    // コンポーネントマウント時にロールを引き受ける
    assumeRole();
  }, [assumeRole]);

  if (credentials) {
    // テナント固有のリソースにアクセス
    console.log('テナント専用クレデンシャル取得完了');
  }
}
```

### useHttpWithStsフックの使用
```typescript
import useHttpWithSts from './hooks/useHttpWithSts';

function TenantChat() {
  const http = useHttpWithSts({
    useStsTempCredentials: true,
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefreshCredentials: true,
  });

  // APIコールは自動的にSTS署名を使用
  const { data: messages } = http.get('/api/messages');
  
  const sendMessage = async (content: string) => {
    await http.post('/api/messages', { content });
  };
}
```

## セキュリティの利点

1. **短期クレデンシャル**: 1時間で自動的に期限切れ
2. **テナント分離**: IAMポリシーによる厳格な境界
3. **監査証跡**: CloudTrailで全てのAssumeRole操作を記録
4. **最小権限の原則**: テナント固有のリソースのみアクセス可能

## トラブルシューティング

### よくあるエラー

1. **"No tenant ID found in token"**
   - Cognitoユーザーに`custom:tenant_id`属性が設定されているか確認

2. **"Access Denied"**
   - IAMロールの信頼ポリシーを確認
   - リソース名にテナントIDが正しく含まれているか確認

3. **"ExpiredToken"**
   - 自動更新が有効になっているか確認
   - `refreshBuffer`を調整（デフォルト5分前）

### デバッグモード
```javascript
// ブラウザコンソールでデバッグログを有効化
localStorage.setItem('STS_DEBUG', 'true');
```

## ベストプラクティス

1. **リソース命名規則**: 必ず`ResourceName-TenantID`形式を使用
2. **自動更新**: 長時間のセッションでは必ず`autoRefresh: true`を設定
3. **エラーハンドリング**: クレデンシャル取得失敗時の適切な処理
4. **定期的な監査**: CloudTrailログの定期的な確認

## まとめ

この実装により、JWTに含まれるテナントIDが「鍵」となり、STSを通じてテナント固有のAWSリソースへの安全なアクセスが可能になります。アプリケーションレベルのバグがあっても、インフラレベルでテナント間のデータアクセスを完全に防ぐことができます。