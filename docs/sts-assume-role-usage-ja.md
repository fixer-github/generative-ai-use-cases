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
  "custom:tenant_id": "tenant-123", // カスタム属性としてテナントID
  "https://aws.amazon.com/tags": {
    "principal_tags": {
      "TenantID": ["tenant-123"] // IAMポリシーで参照可能
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
  RoleArn: 'arn:aws:iam::123456789012:role/TenantAccessRole',
  RoleSessionName: `tenant-${tenantId}-session`,
  WebIdentityToken: idToken, // テナントIDを含むJWT
});

const response = await stsClient.send(command);
const credentials = {
  accessKeyId: response.Credentials.AccessKeyId,
  secretAccessKey: response.Credentials.SecretAccessKey,
  sessionToken: response.Credentials.SessionToken,
  expiration: response.Credentials.Expiration,
};
```

#### ステップ4: 一時クレデンシャルでAWSリソースにアクセス

```typescript
// テナント固有のDynamoDBテーブルにアクセス
const dynamoClient = new DynamoDBClient({
  credentials: {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  },
});

// tenant-123のデータのみアクセス可能
const result = await dynamoClient.send(
  new GetItemCommand({
    TableName: 'ChatHistory-tenant-123', // IAMポリシーで制限
    Key: { id: { S: 'item-id' } },
  })
);
```

## 設定

### 重要：マルチテナントロールの理解

**システムは常に全テナント共通のマルチテナントIAMロールを作成します。** これはテナントごとのロールではなく、JWTクレームとIAMポリシー条件を通じてテナント分離を実現する単一のロールです。

- **全テナントで1つのロール**: 単一の`MultiTenantAccessRole`が自動的に作成されます
- **JWTによるテナント分離**: 各ユーザーのJWTには`tenant_id`がプリンシパルタグとして含まれます
- **動的な権限**: IAMポリシーは実行時に`${aws:PrincipalTag/TenantID}`を使用してアクセスを制限します

### デフォルト設定（推奨）

`cdk.json`で`tenantRoleArn`を`null`のままにしてください：

```json
{
  "context": {
    "tenantRoleArn": null // システムが自動的にロールを作成します
  }
}
```

デプロイ時、CDKは以下を実行します：

1. 適切な信頼ポリシーを持つ`MultiTenantAccessRole`を作成
2. JWTテナントクレームに基づいて動的に評価される権限を設定
3. 作成されたロールARNをフロントエンドに自動的に渡す

### 上級者向け：カスタムロールの使用（オプション）

`tenantRoleArn`パラメータは、自動作成されるロールの代わりに既存のIAMロールを使用したい場合にのみ必要です：

```json
{
  "context": {
    "tenantRoleArn": "arn:aws:iam::123456789012:role/YourCustomRole"
  }
}
```

**注意**: カスタムロールには適切な信頼ポリシーと権限の設定が必要です。ほとんどのユーザーはデフォルトの自動作成ロールを使用すべきです。

### ユーザーへのテナントID設定

各Cognitoユーザーには`custom:tenant_id`属性を設定する必要があります：

#### 新規ユーザー登録時

```javascript
await cognito.adminCreateUser({
  UserPoolId: userPoolId,
  Username: 'user@example.com',
  UserAttributes: [
    { Name: 'email', Value: 'user@example.com' },
    { Name: 'custom:tenant_id', Value: 'tenant-123' }, // マルチテナントアクセスに必須
  ],
});
```

#### 既存ユーザーの更新

```javascript
await cognito.adminUpdateUserAttributes({
  UserPoolId: userPoolId,
  Username: 'user@example.com',
  UserAttributes: [{ Name: 'custom:tenant_id', Value: 'tenant-456' }],
});
```

#### AWSコンソール経由

1. AWSコンソールでCognito User Poolに移動
2. 「ユーザー」タブに移動
3. ユーザーを選択
4. 「ユーザー属性を編集」をクリック
5. `custom:tenant_id`に適切なテナント識別子を設定（例：「tenant-123」）

### 重要な注意事項

- **テナントIDの形式**: 一貫した命名規則を使用（例：「tenant-123」、「org-acme」、「company-xyz」）
- **リソース命名**: すべてのリソースは`ResourceName-{TenantID}`パターンに従う必要があります
- **テナントIDなし = アクセスなし**: `custom:tenant_id`のないユーザーはテナント分離されたリソースにアクセスできません

## IAMロールの設定

### 重要: セッションタグの仕組み

AssumeRoleWithWebIdentityでは、セッションタグはAPIパラメータとして渡すことができません。代わりに、**JWTトークン内に埋め込まれている必要があります**。これが通常のAssumeRoleとの大きな違いです。

### 単一ロールでマルチテナント対応

1つのIAMロールで全てのテナントに対応できます。各テナントのセッションは、JWTクレームから取得したテナントIDに基づいて自動的に分離されます。

#### 同時アクセスの仕組み

複数のテナントが同じロールを**同時に**使用しても安全です：

```
時刻 10:00:00 - テナント123のユーザーがアクセス
                ↓ AssumeRoleWithWebIdentity (同じロールARN)
                ↓ セッション作成: PrincipalTag/TenantID = "tenant-123"
                ↓ DynamoDBアクセス: ChatHistory-tenant-123 ✓

時刻 10:00:00 - テナント456のユーザーが同時にアクセス
                ↓ AssumeRoleWithWebIdentity (同じロールARN)
                ↓ セッション作成: PrincipalTag/TenantID = "tenant-456"
                ↓ DynamoDBアクセス: ChatHistory-tenant-456 ✓
```

**重要なポイント**：

- 同じIAMロールを使用
- 各AssumeRoleで独立したセッションが作成される
- `${aws:PrincipalTag/TenantID}`はリクエスト時に動的に評価
- テナント間のデータアクセスは不可能

### 信頼ポリシー（Trust Policy）

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
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
    }
  ]
}
```

### アクセス許可ポリシー（Permissions Policy）

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}",
        "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}/index/*"
      ]
    }
  ]
}
```

`${aws:PrincipalTag/TenantID}`は実行時に評価され、JWTから取得したテナントIDに置き換えられます。

## CDKでのデプロイ

### 自動作成（デフォルト）

**システムは安全なテナント分離のために、マルチテナントIAMロールを自動的に作成します。** このロールは、JWTトークン内のテナントIDに基づいて一時的なクレデンシャルを提供するSTS AssumeRoleWithWebIdentityを使用します。

#### 環境変数を使用する方法

環境変数を使用してカスタムテナントロールARNを指定できます（オプション）：

```bash
# カスタムテナントロールARNを指定（オプション）
export TENANT_ROLE_ARN=arn:aws:iam::123456789012:role/CustomTenantRole

# 環境変数を使用してデプロイ
npx cdk deploy GenerativeAiUseCasesStack
```

#### CDKコンテキストを使用する方法

または、`cdk.json`で設定することもできます：

```json
// cdk.json
{
  "context": {
    // 空のままにしてマルチテナントロールを自動作成
    // または必要に応じてカスタムロールARNを指定
    "tenantRoleArn": null
  }
}
```

```bash
# 共通スタックをデプロイ（IAMロールも自動作成）
npx cdk deploy GenerativeAiUseCasesStack
```

#### 設定の優先順位

設定は以下の順序で解決されます（優先度が高い順）：

1. CDKコンテキスト（コマンドライン: `--context` または `cdk.json`）
2. 環境変数（`ENABLE_STS_ASSUME_ROLE`、`TENANT_ROLE_ARN`）
3. デフォルト値（STSはデフォルトで有効）

### カスタムロールの使用

独自のIAMポリシーが必要な場合は、別途ロールを作成して指定できます：

```json
// cdk.json
{
  "context": {
    "tenantRoleArn": "arn:aws:iam::123456789012:role/CustomTenantRole"
  }
}
```

## フロントエンドでの実装

アプリケーションはテナント分離されたリソースにアクセスする際、自動的にSTS認証を使用します。

### useHttpフックの使用

```typescript
import useHttp from './hooks/useHttp';

function TenantChat() {
  // フックは自動的にSTSが有効かどうかを検出し、適切な認証方式を使用
  const http = useHttp();

  // APIコールは透過的に認証を処理
  const { data: messages } = http.get('/api/messages');

  const sendMessage = async (content: string) => {
    await http.post('/api/messages', { content });
  };
}
```

### 高度な使用法：直接STSフックを使用

```typescript
import { useSts } from './hooks/useSts';

function TenantDashboard() {
  const { assumeRole, credentials, isLoading } = useSts({
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefresh: true, // 期限切れ前に自動更新
  });

  useEffect(() => {
    // コンポーネントマウント時にロールを引き受ける
    assumeRole();
  }, [assumeRole]);

  if (credentials) {
    // AWS SDKで直接使用
    const dynamoClient = new DynamoDBClient({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }
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

## マイグレーションガイド

### 新規デプロイの場合

STS認証は現在デフォルトで有効になっています。追加の設定は必要ありません。

### 既存アプリケーションの場合

STSがデフォルトでなかったバージョンからアップグレードする場合：

1. **CDK設定の変更は不要** - STSは現在デフォルトで有効

2. スタックをデプロイ（IAMロールは自動作成）：

   ```bash
   npx cdk deploy GenerativeAiUseCasesStack
   ```

3. フロントエンドコードの変更は不要 - `useHttp`フックがSTSを自動的に検出して使用

4. 異なるテナントシナリオで十分にテスト

### レガシー認証を維持する場合

レガシーのCognito専用認証を維持する必要がある場合（非推奨）：

```json
{
  "context": {
    "enableStsAssumeRole": false
  }
}
```

## ベストプラクティス

1. **リソース命名規則**: 必ず`ResourceName-TenantID`形式を使用
2. **自動更新**: 長時間のセッションでは必ず`autoRefresh: true`を設定
3. **エラーハンドリング**: クレデンシャル取得失敗時の適切な処理
4. **定期的な監査**: CloudTrailログの定期的な確認

## まとめ

この実装により、JWTに含まれるテナントIDが「鍵」となり、STSを通じてテナント固有のAWSリソースへの安全なアクセスが可能になります。アプリケーションレベルのバグがあっても、インフラレベルでテナント間のデータアクセスを完全に防ぐことができます。
