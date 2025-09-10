# Bedrock Chat Proxy 実装ガイド

## 概要
このドキュメントは、Bedrock Chat機能をマルチテナント環境に統合するための一時的なプロキシソリューションの実装ガイドです。

## アーキテクチャ

```
[メインスタック]                    [テナント専用スタック]
    API Gateway                         Python Lambda (FastAPI)
        ↓                                     ↑
    /bedrock-chat/{proxy+}                   |
        ↓                                     |
    TypeScript Proxy Lambda  ----invoke----> |
```

## 残実装タスク

### 1. getTenantIdFromEvent の実装 ✅ 完了

**目的**: リクエストからテナントIDを抽出する

**実装済み**: 既存の共通メソッド `getTenantId` を `utils/tenantUtils.ts` から利用
- Cognitoカスタム属性 `custom:tenant_id` から取得
- 既存システムの命名規則（アンダースコア使用）に統一
- フォールバックとして `DEFAULT_TENANT_ID` 環境変数またはデフォルト値 'default' を使用

**実装箇所**: `/packages/cdk/lambda/bedrock-chat-proxy.ts` で `import { getTenantId } from './utils/tenantUtils';` を使用

### 2. getTenantLambdaArn の実装 ✅ 完了

**目的**: テナントIDからLambda ARNを取得する

**実装済み**: DynamoDB Option A を採用し、metadata フィールドを使用
- 既存の `tenantManager.ts` の `getTenant` 関数を利用
- `metadata.bedrockChatLambdaArn` からARNを取得
- metadataにARNが存在しない場合は命名規則によるフォールバック処理を実装

**実装詳細**:
```typescript
// Tenantsテーブルのスキーマ例
{
  tenantId: "tenant-001",
  metadata: {
    bedrockChatLambdaArn: "arn:aws:lambda:region:account:function:name",
    // その他のメタデータ
  },
  status: "active",
  region: "ap-northeast-1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z"
}
```

**実装箇所**: `/packages/cdk/lambda/bedrock-chat-proxy.ts` の getTenantLambdaArn 関数

### 3. 認証情報の共有 ✅ 完了

**問題**: テナント専用スタックのLambda関数がCognito認証情報を必要とする

**実装済み**: cdk.tenant.jsonに定義されている認証情報を使用
- `userPoolId`、`identityPoolId`、`userPoolClientId`がcdk.tenant.jsonから読み込まれる
- bin/generative-ai-use-cases-tenant.ts経由でTenantBedrockChatStackに渡される
- Lambda関数の環境変数`USER_POOL_ID`と`CLIENT_ID`に設定される

```typescript
// tenant-bedrock-chat-stack.ts (実装済み)
environment: {
  USER_POOL_ID: props.userPoolId || '',
  CLIENT_ID: props.userPoolClientId || '',
}
```

### 4. エラーハンドリングの統一

**問題**: Python (FastAPI) と TypeScript のエラーレスポンス形式の違い

**実装タスク**:
- FastAPIのエラーレスポンス形式を確認
- プロキシ層でエラー形式を変換
- 統一されたエラーコードとメッセージ

### 5. パフォーマンス最適化

**推奨実装**:
- Lambda ARNのキャッシュ（5分間など）
- Connection poolingの実装
- Circuit breaker パターンの実装

```typescript
// キャッシュの実装例
const cache = new Map<string, { arn: string; expiry: number }>();

function getCachedArn(tenantId: string): string | null {
  const cached = cache.get(tenantId);
  if (cached && cached.expiry > Date.now()) {
    return cached.arn;
  }
  return null;
}
```

### 6. モニタリングとログ

**実装タスク**:
- CloudWatch カスタムメトリクスの追加
- X-Ray トレーシングの設定
- ログの相関ID実装

```typescript
// メトリクス送信例
const cloudwatch = new CloudWatchClient({});
await cloudwatch.send(new PutMetricDataCommand({
  Namespace: 'BedrockChatProxy',
  MetricData: [{
    MetricName: 'ProxyLatency',
    Value: latency,
    Unit: 'Milliseconds',
    Dimensions: [{ Name: 'TenantId', Value: tenantId }]
  }]
}));
```

## デプロイ手順

1. テナント専用スタックのデプロイ
```bash
cdk deploy *-TenantBedrockChatStack --context tenantId=tenant-001
```

2. Lambda ARNの登録（DynamoDB metadata フィールド使用）
```bash
# 既存のテナントのmetadataを更新
aws dynamodb update-item --table-name Tenants-dev \
  --key '{"tenantId": {"S": "tenant-001"}}' \
  --update-expression "SET metadata.bedrockChatLambdaArn = :arn" \
  --expression-attribute-values '{":arn": {"S": "arn:aws:lambda:region:account:function:name"}}'

# または、tenantManager のupdateTenant関数を使用してプログラムで更新
```

3. メインスタックの更新
```bash
cdk deploy GenerativeAiUseCasesStack
```

## テスト方法

1. ユニットテスト
```typescript
// test/bedrock-chat-proxy.test.ts
describe('BedrockChatProxy', () => {
  it('should extract tenant ID from Cognito claims', async () => {
    // テスト実装
  });
  
  it('should handle Lambda invocation errors', async () => {
    // テスト実装
  });
});
```

2. 統合テスト
```bash
# APIエンドポイントのテスト
curl -X POST https://api.example.com/bedrock-chat/conversation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

## セキュリティ考慮事項

1. **テナント間アクセス制御**
   - テナントIDの検証を必ず実施
   - Cross-tenant アクセスの防止

2. **Lambda実行権限**
   - 最小権限の原則に従う
   - 特定のLambda関数パターンのみ許可

3. **データ暗号化**
   - 転送中のデータ: TLS
   - 保存データ: KMS暗号化

## 移行計画

この実装は一時的なソリューションです。将来的には以下の移行を検討：

1. **Phase 1** (現在): プロキシベースの統合
2. **Phase 2**: 共通認証基盤の統一
3. **Phase 3**: TypeScriptへの完全移行
4. **Phase 4**: ネイティブマルチテナント実装

## トラブルシューティング

### Lambda関数が見つからない
- CloudFormation出力を確認
- Lambda関数の命名規則を確認
- IAM権限を確認

### 認証エラー
- Cognitoトークンの有効性を確認
- カスタム属性の設定を確認
- CORS設定を確認

### パフォーマンス問題
- Lambda関数のコールドスタート対策
- キャッシュの有効化
- 同時実行数の制限確認

## 参考リンク

- [AWS Lambda Invoke API](https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)