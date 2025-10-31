# DynamoDB ハンズオンワークショップ

**所要時間**: 4時間（休憩含む）
**対象者**: GenU開発チーム全員
**前提知識**: JavaScript/TypeScript基礎、AWS基礎知識

このワークショップでは、GenUプラットフォームでDynamoDBを使った開発を**実践的に**学びます。

---

## 📋 目次

1. [ワークショップの準備](#ワークショップの準備)
2. [セッション1: DynamoDB基礎（60分）](#セッション1-dynamodb基礎60分)
3. [セッション2: GenUのスキーマ理解（60分）](#セッション2-genuのスキーマ理解60分)
4. [休憩（15分）](#休憩15分)
5. [セッション3: 実装演習（90分）](#セッション3-実装演習90分)
6. [セッション4: トラブルシューティング演習（30分）](#セッション4-トラブルシューティング演習30分)
7. [まとめとQ&A（15分）](#まとめとqa15分)

---

## ワークショップの準備

### 事前準備（参加者各自）

#### 1. リポジトリのクローンとセットアップ

```bash
# リポジトリをクローン（既にクローン済みの場合はスキップ）
git clone <repository-url>
cd generative-ai-use-cases

# 依存関係をインストール
npm ci

# 環境をセットアップ（AWS認証情報が必要）
npm run web:devw
```

#### 2. ドキュメントの事前読了

- **必須**: [DynamoDBクイックスタートガイド](./DYNAMODB_QUICKSTART.md)（15分）
- **推奨**: [DynamoDBスキーマドキュメント](./DYNAMODB_SCHEMA.md)の概要部分（10分）

#### 3. AWSコンソールへのアクセス確認

- AWS Management Console にログイン
- DynamoDBサービスにアクセスできることを確認
- CloudWatch Logsにアクセスできることを確認

### 必要なツール

- **エディタ**: VS Code（推奨）
- **ターミナル**: bash/zsh
- **AWS CLI**: バージョン2.x
- **Node.js**: v18.x 以上

---

## セッション1: DynamoDB基礎（60分）

**目標**: DynamoDBの基本概念とSQLとの違いを理解する

### 講義パート（30分）

#### 1. DynamoDBとは？（10分）

**講師が説明**:
- NoSQLデータベースの概要
- DynamoDBの特徴（キーバリューストア、スキーマレス、サーバーレス）
- なぜGenUでDynamoDBを選んだのか

**デモ**:
- AWSコンソールでDynamoDBテーブルを表示
- アイテムの構造を確認

---

#### 2. SQLとの主要な違い（10分）

**講師が説明**:

| 概念 | SQL | DynamoDB |
|------|-----|----------|
| データモデル | テーブル（行と列） | Key-Valueペア |
| スキーマ | 固定スキーマ | スキーマレス |
| クエリ | 任意の列で検索可能 | Partition Key必須 |
| インデックス | 後から追加容易 | 事前定義が必要 |

**デモ**:
```sql
-- SQLの例
SELECT * FROM chats WHERE user_id = 123;
```

```typescript
// DynamoDBの例
KeyConditionExpression: "id = :userId"
```

---

#### 3. キーの概念（10分）

**講師が説明**:
- **Partition Key**: データを分散するためのキー（必須）
- **Sort Key**: Partition Key内でソートするキー（オプション）
- **複合キー**: Partition Key + Sort Key

**デモ**:
```typescript
// GenUの例
{
  id: "user#alice",           // Partition Key
  createdDate: "2025-01-15",  // Sort Key
  chatId: "chat#123",
  title: "My Chat"
}
```

---

### 演習パート（30分）

#### 演習1-1: AWSコンソールでテーブルを探索（10分）

**目標**: DynamoDBテーブルの構造を理解する

**手順**:
1. AWS Management Console → DynamoDB
2. テーブル一覧で `ChatHistory-dev-...` を選択
3. 「項目を探索」をクリック
4. いくつかのアイテムを確認

**確認事項**:
- ✅ Partition Key (`id`) の値のパターン
- ✅ Sort Key (`createdDate`) の値の形式
- ✅ 異なるエンティティタイプ（Chat、Message、Share）が混在していること

---

#### 演習1-2: AWS CLIでクエリ実行（20分）

**目標**: 基本的なDynamoDB操作をCLIで体験する

**手順1: テーブル名を確認**

```bash
# テーブル一覧を取得
aws dynamodb list-tables

# 期待される出力:
# "ChatHistory-dev-...", "TokenUsageStats-dev-...", ...
```

**手順2: 単一アイテムを取得（GetItem）**

```bash
# 自分のユーザーIDを確認（Cognito User Pool -> ユーザー）
export USER_ID="<your-user-id>"
export TABLE_NAME="ChatHistory-dev-..."

# GetItem
aws dynamodb get-item \
  --table-name $TABLE_NAME \
  --key "{\"id\": {\"S\": \"user#${USER_ID}\"}, \"createdDate\": {\"S\": \"2025-01-15T10:00:00.000Z\"}}"
```

**手順3: クエリ（Query）**

```bash
# ユーザーのチャット一覧を取得
aws dynamodb query \
  --table-name $TABLE_NAME \
  --key-condition-expression "id = :userId" \
  --expression-attribute-values "{\":userId\": {\"S\": \"user#${USER_ID}\"}}" \
  --limit 5
```

**確認事項**:
- ✅ Queryで複数のアイテムが返ってくること
- ✅ Sort Keyで自動的にソートされていること

---

#### 演習1-3: グループディスカッション（5分）

**テーマ**: SQLと比較して、DynamoDBの利点・欠点は何か？

**ディスカッションポイント**:
- スケーラビリティ
- クエリの柔軟性
- 運用負荷
- コスト

---

## セッション2: GenUのスキーマ理解（60分）

**目標**: GenUの実際のDynamoDBスキーマを深く理解する

### 講義パート（30分）

#### 1. シングルテーブル設計（10分）

**講師が説明**:
- GenUは1つのテーブル（Main Table）に複数のエンティティを格納
- Partition Keyのプレフィックスでエンティティを区別

**デモ**:
```typescript
// チャット
id: "user#alice",     createdDate: "2025-01-15T10:00:00Z"

// メッセージ
id: "chat#456",       createdDate: "2025-01-15T10:05:00Z#0"

// 共有
id: "share#789",      createdDate: "2025-01-15T12:00:00Z"
```

**メリット**:
- 関連データを1回のクエリで取得可能
- テーブル数が少ない（コスト削減）

---

#### 2. テナント分離パターン（10分）

**講師が説明**:
- マルチテナント: テナントごとに独立したテーブル
- `getTenantDynamoDBDocument()` が自動的に適切なテーブルを選択
- Cognito JWTから `custom:tenantId` を抽出

**デモ**:
```typescript
// packages/cdk/lambda/repository/common.ts
const dynamodb = await getTenantDynamoDBDocument(event);
const tableName = getTableName(event);
// → "ChatHistory-dev-tenant-acme"
```

---

#### 3. リポジトリパターン（10分）

**講師が説明**:
- GenUはRepository Patternを採用
- DynamoDBの詳細を隠蔽
- Lambda関数はリポジトリ層を通じてデータアクセス

**デモ**:
```typescript
// packages/cdk/lambda/repository/chat.ts
export const listChats = async (userId, event) => {
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  const result = await dynamodb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "id = :userId",
    ExpressionAttributeValues: { ":userId": `user#${userId}` }
  }));

  return result.Items || [];
};
```

---

### 演習パート（30分）

#### 演習2-1: コードリーディング（20分）

**目標**: リポジトリ層のコードを読んで理解する

**手順**:
1. `packages/cdk/lambda/repository/chat.ts` を開く
2. 以下の関数を読む:
   - `listChats` (行88-)
   - `createChat` (行21-)
   - `findChatById` (行57-)

**確認事項**:
- ✅ `getTenantDynamoDBDocument()` を使っているか
- ✅ Partition Keyとして何を使っているか
- ✅ Sort Keyはどう使われているか
- ✅ UpdateExpressionの構文

**グループで議論**:
- `findChatById` でなぜFilterExpressionを使っているのか？
- より効率的な方法はあるか？

---

#### 演習2-2: スキーマドキュメントの確認（10分）

**目標**: 全テーブルの構造を把握する

**手順**:
1. [DynamoDBスキーマドキュメント](./DYNAMODB_SCHEMA.md) を開く
2. 以下のテーブルの構造を確認:
   - Main Table
   - Stats Table
   - UseCaseBuilder Table

**確認事項**:
- ✅ 各テーブルのPartition Key / Sort Key
- ✅ Global Secondary Index (GSI) の用途
- ✅ アクセスパターン

---

## 休憩（15分）

☕ コーヒーブレイク

---

## セッション3: 実装演習（90分）

**目標**: 実際にコードを書いてDynamoDB操作を体験する

### 演習3-1: 新しいLambda関数を作成（30分）

**課題**: ユーザーのチャット統計を取得するLambda関数を実装する

**要件**:
- エンドポイント: `GET /users/{userId}/stats`
- 返り値: `{ totalChats: number, recentChats: Chat[] }`

#### ステップ1: Lambda関数の作成

**ファイル**: `packages/cdk/lambda/getUserStats.ts`（新規作成）

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listChats } from './repository/chat';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // TODO: userIdをパスパラメータから取得
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'userId is required' })
      };
    }

    // TODO: リポジトリ層を使ってチャット一覧を取得
    const chats = await listChats(userId, event);

    // TODO: 統計を計算
    const stats = {
      totalChats: chats.length,
      recentChats: chats.slice(0, 5)  // 最新5件
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(stats)
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
```

#### ステップ2: CDKでAPIエンドポイントを定義

**ファイル**: `packages/cdk/lib/construct/api/index.ts`（既存ファイルに追記）

```typescript
// getUserStats Lambda関数の追加
const getUserStatsFunction = new lambda.Function(this, 'GetUserStats', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'getUserStats.handler',
  code: lambda.Code.fromAsset('lambda'),
  environment: {
    TABLE_NAME: props.table.tableName
  }
});

// DynamoDB読み取り権限を付与
props.table.grantReadData(getUserStatsFunction);

// API Gatewayにエンドポイントを追加
api.addRoutes({
  path: '/users/{userId}/stats',
  methods: [apigw.HttpMethod.GET],
  integration: new apigw_integrations.HttpLambdaIntegration(
    'GetUserStatsIntegration',
    getUserStatsFunction
  )
});
```

#### ステップ3: デプロイとテスト

```bash
# CDKデプロイ
npm run cdk:deploy:quick:hotswap

# エンドポイントをテスト
curl https://<api-endpoint>/users/<your-user-id>/stats
```

**期待される出力**:
```json
{
  "totalChats": 10,
  "recentChats": [
    { "chatId": "chat#123", "title": "最新のチャット", ... },
    ...
  ]
}
```

---

### 演習3-2: メッセージにタグ機能を追加（30分）

**課題**: メッセージにタグを付ける機能を実装する

**要件**:
- メッセージに `tags` 属性を追加（文字列配列）
- タグを更新するLambda関数を実装

#### ステップ1: スキーマの拡張

**ファイル**: `packages/types/src/index.d.ts`（既存ファイルに追記）

```typescript
export interface Message {
  // 既存の属性...
  messageId: string;
  role: string;
  content: string;
  // 新しい属性
  tags?: string[];  // 追加
}
```

#### ステップ2: リポジトリ層に関数を追加

**ファイル**: `packages/cdk/lambda/repository/message.ts`（既存ファイルに追記）

```typescript
export const updateMessageTags = async (
  chatId: string,
  messageId: string,
  tags: string[],
  event: APIGatewayProxyEvent
): Promise<void> => {
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  // TODO: まずメッセージを検索して createdDate を取得
  const messages = await listMessages(chatId, event);
  const message = messages.find(m => m.messageId === messageId);

  if (!message) {
    throw new Error('Message not found');
  }

  // TODO: UpdateCommandでtagsを更新
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      id: `chat#${chatId}`,
      createdDate: message.createdDate
    },
    UpdateExpression: "SET tags = :tags",
    ExpressionAttributeValues: {
      ":tags": tags
    }
  }));
};
```

#### ステップ3: Lambda関数の実装

**ファイル**: `packages/cdk/lambda/updateMessageTags.ts`（新規作成）

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateMessageTags } from './repository/message';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const chatId = event.pathParameters?.chatId;
    const messageId = event.pathParameters?.messageId;
    const body = JSON.parse(event.body || '{}');
    const tags: string[] = body.tags || [];

    if (!chatId || !messageId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'chatId and messageId are required' })
      };
    }

    // TODO: タグを更新
    await updateMessageTags(chatId, messageId, tags, event);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

#### ステップ4: テスト

```bash
# デプロイ
npm run cdk:deploy:quick:hotswap

# テスト
curl -X PUT https://<api-endpoint>/chats/<chat-id>/messages/<message-id>/tags \
  -H "Content-Type: application/json" \
  -d '{"tags": ["重要", "フォローアップ必要"]}'
```

---

### 演習3-3: グループ演習（30分）

**課題**: 以下のいずれかの機能を実装する（グループで1つ選択）

#### オプションA: チャットにお気に入り機能を追加

**要件**:
- チャットに `isFavorite` フラグを追加
- お気に入りチャット一覧を取得するエンドポイント

**ヒント**:
- UpdateCommandで `isFavorite` を更新
- FilterExpressionで `isFavorite = true` を検索

---

#### オプションB: メッセージ検索機能を追加

**要件**:
- メッセージの内容をキーワード検索する

**ヒント**:
- DynamoDBでは全文検索は不可
- Scanを使うか、ElasticSearchとの連携を検討

---

#### オプションC: チャット削除時の統計更新

**要件**:
- チャット削除時に、関連する統計データも更新する

**ヒント**:
- `deleteChat` で削除されるメッセージ数を計算
- 統計テーブルから該当分を減算（ADDで負の値を使用）

---

## セッション4: トラブルシューティング演習（30分）

**目標**: よくあるエラーに対処する経験を積む

### 演習4-1: エラー修正演習（20分）

**課題**: 以下のコードにはバグがあります。修正してください。

#### 問題1: ResourceNotFoundException

```typescript
// バグのあるコード
export const handler = async (event: APIGatewayProxyEvent) => {
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const result = await dynamodb.send(new QueryCommand({
    TableName: "ChatHistory",  // ❌ 問題: テナントコンテキストを無視
    KeyConditionExpression: "id = :userId",
    ExpressionAttributeValues: {
      ":userId": `user#${userId}`
    }
  }));
};
```

**質問**: 何が問題で、どう修正すべきか？

<details>
<summary>回答</summary>

**問題**:
1. テナントコンテキストを無視している
2. ハードコードされたテーブル名

**修正**:
```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  // ✅ テナントコンテキストを使用
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  const result = await dynamodb.send(new QueryCommand({
    TableName: tableName,  // ✅ 動的なテーブル名
    KeyConditionExpression: "id = :userId",
    ExpressionAttributeValues: {
      ":userId": `user#${userId}`
    }
  }));
};
```
</details>

---

#### 問題2: ValidationException

```typescript
// バグのあるコード
await dynamodb.send(new UpdateCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: chat.createdDate
  },
  UpdateExpression: "SET status = :status",  // ❌ 問題: statusは予約語
  ExpressionAttributeValues: {
    ":status": "active"
  }
}));
```

**質問**: 何が問題で、どう修正すべきか？

<details>
<summary>回答</summary>

**問題**: `status` はDynamoDBの予約語

**修正**:
```typescript
await dynamodb.send(new UpdateCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: chat.createdDate
  },
  UpdateExpression: "SET #status = :status",  // ✅ プレースホルダーを使用
  ExpressionAttributeNames: {
    "#status": "status"  // ✅ 予約語をエスケープ
  },
  ExpressionAttributeValues: {
    ":status": "active"
  }
}));
```
</details>

---

### 演習4-2: パフォーマンス問題のデバッグ（10分）

**課題**: 以下のコードは動作するが、パフォーマンスが悪い。改善してください。

```typescript
// 遅いコード
export const findMessagesByFeedback = async (
  chatId: string,
  feedback: 'good' | 'bad',
  event: APIGatewayProxyEvent
) => {
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  // ❌ 問題: Scanでテーブル全体を検索
  const result = await dynamodb.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: "chatId = :chatId AND feedback = :feedback",
    ExpressionAttributeValues: {
      ":chatId": chatId,
      ":feedback": feedback
    }
  }));

  return result.Items || [];
};
```

**質問**: どこが問題で、どう改善すべきか？

<details>
<summary>回答</summary>

**問題**:
1. Scanを使用（テーブル全体をスキャン）
2. GSI (FeedbackIndex) を使っていない

**改善**:
```typescript
export const findMessagesByFeedback = async (
  chatId: string,
  feedback: 'good' | 'bad',
  event: APIGatewayProxyEvent
) => {
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  // ✅ 方法1: Queryでchat#<chatId>を検索後、FilterExpression
  const result = await dynamodb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "id = :chatId",
    FilterExpression: "feedback = :feedback",
    ExpressionAttributeValues: {
      ":chatId": `chat#${chatId}`,
      ":feedback": feedback
    }
  }));

  return result.Items || [];
};

// ✅ 方法2: FeedbackIndexを使用（チャットIDでフィルタ）
// Note: この方法はfeedbackで検索後、chatIdでフィルタするため、
// 特定チャットのフィードバックを探す用途には非効率な場合がある
```
</details>

---

## まとめとQ&A（15分）

### 学んだことの振り返り

**参加者に質問**:
1. DynamoDBの最も重要な概念は何か？
2. SQLと比較して、DynamoDBの利点は？
3. GenUでDynamoDBを使う際の注意点は？

### チェックリスト

ワークショップ後、以下を確認してください：

- ✅ Partition Key / Sort Keyの概念を理解した
- ✅ Query vs Scanの違いを理解した
- ✅ UpdateExpressionの基本構文を理解した
- ✅ `getTenantDynamoDBDocument()` の重要性を理解した
- ✅ リポジトリ層を使ってDynamoDB操作ができる
- ✅ よくあるエラーとその対処法を知っている

### 次のステップ

1. **実際の開発で使ってみる**: 小さなタスクから始める
2. **ドキュメントを参照**: わからないことがあればチートシートを見る
3. **チームメンバーに相談**: 困ったら遠慮なく質問
4. **定期的に復習**: 1週間後にもう一度ドキュメントを読み返す

---

## 📚 参考資料

### GenU内部ドキュメント

- **[DynamoDBクイックスタートガイド](./DYNAMODB_QUICKSTART.md)**: 基礎知識
- **[DynamoDBチートシート](./DYNAMODB_CHEATSHEET.md)**: コード例集
- **[DynamoDBスキーマドキュメント](./DYNAMODB_SCHEMA.md)**: テーブル仕様
- **[トラブルシューティングガイド](./DYNAMODB_TROUBLESHOOTING.md)**: エラー対処法

### 外部リソース

- **AWS公式**: [DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/latest/developerguide/)（英語）
- **AWS公式**: [ベストプラクティス](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)（英語）
- **動画**: [AWS re:Invent - DynamoDB Deep Dive](https://www.youtube.com/results?search_query=dynamodb+deep+dive)（英語）

---

## 🎉 ワークショップ修了！

お疲れ様でした！このワークショップで学んだことを実際の開発に活かしてください。

**フィードバックをお願いします**:
- ワークショップの内容はわかりやすかったか？
- もっと詳しく知りたいトピックは？
- 改善点は？

---

## 付録: ワークショップファシリテーターガイド

### 準備（ファシリテーター向け）

#### 1週間前
- [ ] 参加者に事前資料を共有
- [ ] AWS環境のアクセス権限を確認
- [ ] デモ用のサンプルデータを準備

#### 前日
- [ ] プロジェクター/画面共有の動作確認
- [ ] AWSコンソールのデモ環境を確認
- [ ] コード例の動作確認

#### 当日
- [ ] 参加者の開発環境をサポート
- [ ] 時間配分に注意（各セッションの時間を守る）
- [ ] 質問を促す雰囲気作り

### タイムキーピング

| セッション | 開始時刻 | 終了時刻 | 内容 |
|-----------|---------|---------|------|
| セッション1 | 10:00 | 11:00 | DynamoDB基礎 |
| セッション2 | 11:00 | 12:00 | GenUスキーマ |
| 休憩 | 12:00 | 12:15 | |
| セッション3 | 12:15 | 13:45 | 実装演習 |
| セッション4 | 13:45 | 14:15 | トラブルシューティング |
| まとめ | 14:15 | 14:30 | Q&A |

### よくある質問と回答

**Q: DynamoDBはSQLより難しいですか？**
A: 概念は異なりますが、慣れれば同程度です。GenUではリポジトリ層で抽象化されているため、学習コストは低いです。

**Q: いつScanを使ってもいいですか？**
A: 基本的に避けるべきです。テーブルが小さい場合（数百件以下）や、管理画面の一括処理など、パフォーマンスが重要でない場合のみ。

**Q: GSIを後から追加できますか？**
A: 技術的には可能ですが、既存データの再インデックスが必要で時間がかかります。スキーマ設計時に慎重に検討してください。

---

このワークショップ資料は継続的に改善していきましょう！
