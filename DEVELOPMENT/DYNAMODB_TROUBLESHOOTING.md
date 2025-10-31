# DynamoDB トラブルシューティングガイド

**対象**: GenU開発者向け、DynamoDBでよくある問題と解決方法

このガイドでは、GenUでDynamoDBを使用する際に**よく遭遇する問題**と、その**解決方法**をまとめています。

---

## 📋 目次

1. [エラーメッセージ別トラブルシューティング](#エラーメッセージ別トラブルシューティング)
2. [パフォーマンス問題](#パフォーマンス問題)
3. [データが見つからない問題](#データが見つからない問題)
4. [テナント関連の問題](#テナント関連の問題)
5. [ローカル開発での問題](#ローカル開発での問題)
6. [デバッグ方法](#デバッグ方法)

---

## エラーメッセージ別トラブルシューティング

### ❌ ResourceNotFoundException

**エラーメッセージ**:
```
ResourceNotFoundException: Requested resource not found: Table: ChatHistory-dev-tenant-xyz not found
```

**原因**:
1. テーブルが存在しない
2. テーブル名が間違っている
3. テナントIDが間違っている
4. AWS リージョンが間違っている

**解決方法**:

#### ステップ1: テーブル名を確認

```typescript
// デバッグ用のログを追加
const tableName = getTableName(event);
console.log('Using table:', tableName);
```

#### ステップ2: AWS コンソールで確認

1. AWS Management Console → DynamoDB
2. テーブル一覧で実際のテーブル名を確認
3. リージョンが正しいか確認（`us-east-1`など）

#### ステップ3: テナントコンテキストを確認

```typescript
// Cognito JWTクレームを確認
const claims = event.requestContext.authorizer?.claims;
console.log('Cognito claims:', JSON.stringify(claims, null, 2));
console.log('Tenant ID:', claims?.['custom:tenantId']);
```

#### ステップ4: CDKデプロイを確認

```bash
# テナントスタックがデプロイされているか確認
npm run cdk:tenant:list

# デプロイされていない場合はデプロイ
npm run cdk:tenant:deploy
```

---

### ❌ ValidationException

**エラーメッセージ**:
```
ValidationException: Invalid KeyConditionExpression: Syntax error; token: "AND", near: "id = :userId AND"
```

**原因**:
1. `KeyConditionExpression` の構文エラー
2. `UpdateExpression` の構文エラー
3. 予約語を属性名に使用している

**解決方法**:

#### パターン1: KeyConditionExpression の構文確認

```typescript
// ❌ 間違い: Sort Keyを忘れている
KeyConditionExpression: "id = :userId AND"  // 不完全

// ✅ 正しい
KeyConditionExpression: "id = :userId AND createdDate > :date"
```

#### パターン2: 予約語の回避

```typescript
// ❌ 間違い: "data" は予約語
UpdateExpression: "SET data = :data"

// ✅ 正しい: ExpressionAttributeNames を使用
UpdateExpression: "SET #data = :data"
ExpressionAttributeNames: {
  "#data": "data"
}
```

**DynamoDBの予約語リスト**: [AWS公式ドキュメント](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)

よくある予約語:
- `name`, `data`, `status`, `timestamp`, `date`, `time`
- `user`, `group`, `role`

---

### ❌ ConditionalCheckFailedException

**エラーメッセージ**:
```
ConditionalCheckFailedException: The conditional request failed
```

**原因**:
`ConditionExpression` で指定した条件が満たされなかった

**解決方法**:

#### ケース1: アイテムが既に存在する

```typescript
try {
  await dynamodb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(id)"  // 重複チェック
  }));
} catch (error) {
  if (error instanceof ConditionalCheckFailedException) {
    console.log('アイテムは既に存在します');
    // 既存アイテムを更新するか、エラーを返す
  }
}
```

#### ケース2: 楽観的ロックの失敗

```typescript
try {
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: { id: 'user#123', createdDate: '2025-01-15' },
    UpdateExpression: "SET title = :title, version = version + :inc",
    ConditionExpression: "version = :currentVersion",
    ExpressionAttributeValues: {
      ":title": "新しいタイトル",
      ":currentVersion": 5,
      ":inc": 1
    }
  }));
} catch (error) {
  if (error instanceof ConditionalCheckFailedException) {
    console.log('バージョンが一致しません（他のユーザーが更新した）');
    // 再取得して再試行
  }
}
```

---

### ❌ AccessDeniedException

**エラーメッセージ**:
```
AccessDeniedException: User: arn:aws:sts::123456789012:assumed-role/... is not authorized to perform: dynamodb:Query on resource: ...
```

**原因**:
1. IAMロールに必要な権限がない
2. テナント分離で、別のテナントのテーブルにアクセスしようとした

**解決方法**:

#### ステップ1: IAMロールを確認

```bash
# Lambda関数のIAMロールを確認
aws lambda get-function --function-name <function-name> --query 'Configuration.Role'

# ロールのポリシーを確認
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>
```

#### ステップ2: CDKでポリシーを確認

```typescript
// packages/cdk/lib/construct/api/index.ts などで定義されているポリシー
table.grantReadWriteData(lambdaFunction);  // 読み書き権限を付与
```

#### ステップ3: テナントIDの確認

```typescript
// 正しいテナントのテーブルにアクセスしているか確認
const tableName = getTableName(event);
console.log('Table name:', tableName);

// Cognito JWTのテナントIDを確認
const tenantId = event.requestContext.authorizer?.claims?.['custom:tenantId'];
console.log('Tenant ID:', tenantId);
```

---

### ❌ ItemCollectionSizeLimitExceededException

**エラーメッセージ**:
```
ItemCollectionSizeLimitExceededException: Item collection size limit exceeded
```

**原因**:
同じPartition Keyを持つアイテムの合計サイズが**10GB**を超えた

**解決方法**:

#### 対策1: Partition Keyの設計を見直す

```typescript
// ❌ 問題: すべてのメッセージが同じPartition Key
id: `chat#${chatId}`  // 1つのチャットに10GB以上のメッセージ

// ✅ 改善案: チャットIDに日付を含める
id: `chat#${chatId}#${month}`  // 月ごとにPartition Keyを分割
```

#### 対策2: 古いデータをアーカイブ

```typescript
// 古いメッセージをS3にアーカイブして削除
// DynamoDBには最近のデータのみ保持
```

**Note**: GenUの現在の設計では、通常このエラーは発生しません（1チャットあたり10GBは非現実的）。

---

## パフォーマンス問題

### 問題: クエリが遅い

**症状**:
- クエリに1秒以上かかる
- CloudWatch Logsで高いレイテンシを確認

**原因と解決方法**:

#### 原因1: Scan を使っている

```typescript
// ❌ 遅い: テーブル全体をスキャン
const result = await dynamodb.send(new ScanCommand({
  TableName: tableName,
  FilterExpression: "userId = :userId"
}));

// ✅ 速い: Query を使用
const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :userId",
  ExpressionAttributeValues: { ":userId": `user#${userId}` }
}));
```

**解決**: 常に`Query`を使用し、`Scan`は避ける。

---

#### 原因2: FilterExpression で大量のデータをフィルタ

```typescript
// ❌ 非効率: 1000件取得後、1件にフィルタ
const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :userId",  // 1000件ヒット
  FilterExpression: "chatId = :chatId",     // 1件に絞り込み
  ExpressionAttributeValues: {
    ":userId": `user#${userId}`,
    ":chatId": "chat#123"
  }
}));
```

**解決**: KeyConditionExpressionで可能な限り絞り込む。

```typescript
// ✅ 効率的: GSIを使う、またはスキーマ設計を見直す
// 例: chat-user インデックスを追加
```

---

#### 原因3: 大量のアイテムを1度に取得

```typescript
// ❌ 非効率: Limit を設定せずに大量取得
const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :chatId"
  // Limit なし → 全メッセージを取得（数千件）
}));
```

**解決**: ページネーションを使う。

```typescript
// ✅ 効率的: Limit + ページネーション
const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :chatId",
  Limit: 100,  // 最初の100件のみ
  ExclusiveStartKey: lastKey  // ページネーション
}));
```

---

### 問題: 統計更新が遅い

**症状**:
`batchCreateMessages` で統計更新に時間がかかる

**原因**:
ネストしたJSON属性の更新が複雑

**解決方法**:

#### 現在の実装を確認

```typescript
// packages/cdk/lambda/repository/message.ts:44-145
// 複雑なUpdateExpression
```

**最適化案**:

1. **バッチ化**: 複数の統計更新を1つのUpdateCommandにまとめる（既に実装済み）
2. **非同期化**: 統計更新を別のLambda関数で非同期実行（DynamoDB Streams使用）
3. **集計頻度の見直し**: リアルタイム集計ではなく、バッチ集計を検討

---

## データが見つからない問題

### 問題: 作成したはずのデータが見つからない

**デバッグ手順**:

#### ステップ1: PutCommandが成功したか確認

```typescript
try {
  const result = await dynamodb.send(new PutCommand({
    TableName: tableName,
    Item: item
  }));
  console.log('Put成功:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Put失敗:', error);
  throw error;
}
```

#### ステップ2: 正しいKeyで検索しているか確認

```typescript
// PutCommand で保存
Item: {
  id: `user#${userId}`,
  createdDate: "2025-01-15T10:00:00.000Z",
  chatId: "chat#123"
}

// QueryCommand で検索
KeyConditionExpression: "id = :userId"  // ✅ 正しい
ExpressionAttributeValues: {
  ":userId": `user#${userId}`  // ⚠️ userIdの形式が一致しているか確認
}
```

#### ステップ3: テナントコンテキストを確認

```typescript
// 保存時のテーブル名
const putTableName = getTableName(putEvent);
console.log('Put table:', putTableName);

// 検索時のテーブル名
const queryTableName = getTableName(queryEvent);
console.log('Query table:', queryTableName);

// ⚠️ 異なるテナントのテーブルを使っていないか確認
```

#### ステップ4: AWS コンソールで直接確認

1. AWS Management Console → DynamoDB → テーブル
2. 「項目を探索」でアイテムを直接検索
3. アイテムが実際に存在するか確認

---

### 問題: LastEvaluatedKey が正しく動作しない

**症状**:
ページネーションで次のページが取得できない

**原因と解決方法**:

#### 原因1: LastEvaluatedKeyのエンコーディング

```typescript
// ❌ 間違い: 直接JSONを返す
return {
  items: result.Items,
  nextKey: result.LastEvaluatedKey  // オブジェクトのまま
};

// ✅ 正しい: Base64エンコード
return {
  items: result.Items,
  nextKey: result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined
};
```

#### 原因2: デコーディング

```typescript
// クライアントから受け取ったnextKeyをデコード
const exclusiveStartKey = nextKey
  ? JSON.parse(Buffer.from(nextKey, 'base64').toString('utf-8'))
  : undefined;
```

---

## テナント関連の問題

### 問題: 別のテナントのデータが見える

**⚠️ 重大なセキュリティ問題**: すぐに調査が必要

**デバッグ手順**:

#### ステップ1: テナントIDを確認

```typescript
const claims = event.requestContext.authorizer?.claims;
console.log('User sub:', claims?.sub);
console.log('Tenant ID:', claims?.['custom:tenantId']);
```

#### ステップ2: 使用しているテーブル名を確認

```typescript
const tableName = getTableName(event);
console.log('Table name:', tableName);

// 期待値:
// - テナントA: ChatHistory-dev-tenant-tenantA
// - テナントB: ChatHistory-dev-tenant-tenantB
```

#### ステップ3: IAMポリシーを確認

```typescript
// Lambda実行ロールが正しいテーブルのみアクセス可能か確認
// CDKで定義されたポリシーを確認
```

**解決策**:
- `getTenantDynamoDBDocument()` を必ず使用
- 直接DynamoDBクライアントを作成しない
- IAMポリシーでテナント分離を強制

---

### 問題: テナントコンテキストが取得できない

**症状**:
`custom:tenantId` が `undefined` になる

**原因**:
1. Cognitoユーザーにテナント属性が設定されていない
2. JWTトークンにカスタムクレームが含まれていない
3. Cognito User Poolの設定が間違っている

**解決方法**:

#### ステップ1: Cognitoユーザー属性を確認

```bash
# AWS CLIでユーザー属性を確認
aws cognito-idp admin-get-user \
  --user-pool-id <pool-id> \
  --username <username>

# custom:tenantId が設定されているか確認
```

#### ステップ2: カスタムクレームの設定を確認

```bash
# Cognito User Pool → アプリクライアント → 属性の読み取り/書き込み権限
# custom:tenantId が有効になっているか確認
```

#### ステップ3: デフォルトテーブルにフォールバック

```typescript
// packages/cdk/lambda/repository/common.ts
// tenantId がない場合、Control Planeテーブルを使用する設計
```

---

## ローカル開発での問題

### 問題: ローカルからDynamoDBにアクセスできない

**症状**:
`npm run web:devw` で起動後、APIエラーが発生

**原因**:
1. AWS認証情報が設定されていない
2. リージョンが間違っている
3. VPN/ファイアウォールでAWSへのアクセスがブロックされている

**解決方法**:

#### ステップ1: AWS認証情報を確認

```bash
# AWS CLIで認証情報を確認
aws sts get-caller-identity

# 期待される出力:
# {
#   "UserId": "...",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/your-user"
# }
```

#### ステップ2: リージョンを確認

```bash
# .aws/config または環境変数を確認
echo $AWS_REGION

# cdk.jsonで設定されているリージョンと一致しているか確認
```

#### ステップ3: setup-env.shを実行

```bash
# フロントエンド開発時は環境変数を自動設定
npm run web:devw  # setup-env.sh が自動実行される
```

---

### 問題: DynamoDB Localを使いたい

**GenUはDynamoDB Localに対応していません**が、将来的に対応するための手順：

#### セットアップ

```bash
# Docker で DynamoDB Local を起動
docker run -p 8000:8000 amazon/dynamodb-local

# テーブルを作成
aws dynamodb create-table \
  --table-name ChatHistory-dev \
  --attribute-definitions AttributeName=id,AttributeType=S AttributeName=createdDate,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH AttributeName=createdDate,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

#### コード修正

```typescript
// packages/cdk/lambda/repository/common.ts
const dynamodbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.DYNAMODB_ENDPOINT && {
    endpoint: process.env.DYNAMODB_ENDPOINT  // http://localhost:8000
  })
});
```

---

## デバッグ方法

### CloudWatch Logsでデバッグ

#### ログの確認方法

```bash
# AWS CLIでログを確認
aws logs tail /aws/lambda/<function-name> --follow

# または AWS Console → CloudWatch → ロググループ → /aws/lambda/<function-name>
```

#### 効果的なログの書き方

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  // リクエスト情報をログ
  console.log('Event:', JSON.stringify(event, null, 2));

  const tableName = getTableName(event);
  console.log('Using table:', tableName);

  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "id = :userId",
      ExpressionAttributeValues: { ":userId": `user#${userId}` }
    }));

    // 結果をログ
    console.log('Query result:', {
      count: result.Items?.length,
      scannedCount: result.ScannedCount,
      hasMore: !!result.LastEvaluatedKey
    });

    return { statusCode: 200, body: JSON.stringify(result.Items) };
  } catch (error) {
    // エラー詳細をログ
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
};
```

---

### X-Rayトレーシング

GenUはAWS X-Rayを使用してトレーシングを行っています（設定されている場合）。

#### X-Rayコンソールでの確認

1. AWS Console → X-Ray → トレース
2. 遅いリクエストやエラーをフィルタ
3. トレースマップでDynamoDB呼び出しを可視化

---

### DynamoDBのメトリクスを確認

#### CloudWatchメトリクス

1. AWS Console → DynamoDB → テーブル → メトリクス
2. 以下を確認:
   - **ConsumedReadCapacityUnits**: 読み取りコスト
   - **ConsumedWriteCapacityUnits**: 書き込みコスト
   - **UserErrors**: クライアントエラー数
   - **SystemErrors**: サーバーエラー数

#### コストの確認

```bash
# AWS CLIで過去24時間のメトリクスを取得
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=ChatHistory-dev \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

---

## 🆘 それでも解決しない場合

### 1. 既存コードを検索

```bash
# 似たような実装を探す
grep -r "<検索キーワード>" packages/cdk/lambda/repository/

# 例: FilterExpressionの使用例を検索
grep -r "FilterExpression" packages/cdk/lambda/repository/
```

### 2. ドキュメントを再確認

- **[クイックスタートガイド](./DYNAMODB_QUICKSTART.md)**: 基本を見直す
- **[チートシート](./DYNAMODB_CHEATSHEET.md)**: コード例を確認
- **[スキーマドキュメント](./DYNAMODB_SCHEMA.md)**: テーブル構造を確認

### 3. AWS公式ドキュメント

- [DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/latest/developerguide/)
- [DynamoDB API Reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/)
- [AWS SDK for JavaScript v3 - DynamoDB](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/)

### 4. チームメンバーに相談

経験者に以下の情報を共有:
- エラーメッセージ（フルスタックトレース）
- 実行したコード
- CloudWatch Logs
- 期待する動作と実際の動作の違い

---

## 📚 関連リソース

- **[クイックスタートガイド](./DYNAMODB_QUICKSTART.md)**: DynamoDB基礎
- **[チートシート](./DYNAMODB_CHEATSHEET.md)**: コード例集
- **[スキーマドキュメント](./DYNAMODB_SCHEMA.md)**: 全テーブルの仕様
- **[ワークショップ](./DYNAMODB_WORKSHOP.md)**: ハンズオン演習

---

このトラブルシューティングガイドは、チームの経験に基づいて継続的に更新してください！
