# DynamoDB クイックスタートガイド

**所要時間**: 15分
**対象者**: SQL DBに精通しているが、DynamoDBは初めての開発者
**前提知識**: JavaScript/TypeScript、AWS基礎知識

---

## 🎯 このガイドの目的

このガイドを読むことで、GenUプラットフォームでDynamoDBを使った開発を**今日から始められる**ようになります。SQLとの違いを理解し、既存コードのメンテナンスや新機能開発に必要な知識を習得できます。

---

## 📚 目次

1. [DynamoDBとは？（5分）](#dynamodbとは5分)
2. [SQLとの主要な違い（3分）](#sqlとの主要な違い3分)
3. [GenUでの実装パターン（5分）](#genuでの実装パターン5分)
4. [よく使う操作（2分）](#よく使う操作2分)
5. [次のステップ](#次のステップ)

---

## DynamoDBとは？（5分）

### 概要

**DynamoDB**は、AWSが提供する**フルマネージド NoSQLデータベース**です。

#### 特徴

| 特徴 | 説明 | SQLとの違い |
|------|------|------------|
| **キーバリューストア** | データはKey-Valueペアで格納 | テーブルに行と列 |
| **スキーマレス** | 柔軟な属性追加が可能 | 固定スキーマ |
| **水平スケーリング** | 自動的に無制限にスケール | 垂直スケーリングが主 |
| **サーバーレス** | サーバー管理不要 | RDS/Auroraは要管理 |
| **オンデマンド課金** | 使った分だけ課金 | 稼働時間で課金 |

### なぜDynamoDBを選んだのか？

GenUプラットフォームでDynamoDBを採用した理由：

1. **コスト効率**: 現在のワークロードでRDS/Auroraの**1/5のコスト**
2. **運用負荷ゼロ**: パッチ適用、バックアップ、スケーリングがすべて自動
3. **高パフォーマンス**: 一貫した1桁ミリ秒のレイテンシ
4. **マルチテナント**: テーブル分離による強力なテナント分離

---

## SQLとの主要な違い（3分）

### 1. データモデル

#### SQL（リレーショナル）
```sql
-- テーブル: users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100)
);

-- テーブル: chats
CREATE TABLE chats (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  title VARCHAR(255)
);
```

#### DynamoDB（キーバリュー）
```typescript
// 1つのテーブルに複数のエンティティを格納可能
{
  id: "user#123",           // Partition Key
  createdDate: "2025-01-15", // Sort Key
  name: "Alice"
}

{
  id: "user#123",           // 同じPartition Key
  createdDate: "2025-01-16#0", // 異なるSort Key
  chatId: "chat#456",
  title: "My Chat"
}
```

**重要**: DynamoDBは**Key-Valueストア**なので、データを取得するには**キーを知っている必要がある**。

---

### 2. クエリ方法

#### SQL
```sql
-- 柔軟なクエリ（どの列でも検索可能）
SELECT * FROM chats
WHERE user_id = 123
  AND created_at > '2025-01-01'
ORDER BY created_at DESC
LIMIT 10;
```

#### DynamoDB
```typescript
// Partition Keyは必須、Sort Keyで範囲検索可能
await dynamodb.send(new QueryCommand({
  TableName: "ChatHistory",
  KeyConditionExpression: "id = :userId AND createdDate > :date",
  ExpressionAttributeValues: {
    ":userId": "user#123",
    ":date": "2025-01-01"
  },
  ScanIndexForward: false,  // DESCソート
  Limit: 10
}));
```

**重要**:
- ✅ **Query**: Partition Keyを指定（高速、推奨）
- ❌ **Scan**: テーブル全体をスキャン（低速、避けるべき）

---

### 3. インデックス

#### SQL
```sql
-- 任意の列にインデックスを作成
CREATE INDEX idx_user_email ON users(email);
```

#### DynamoDB
```typescript
// GSI（Global Secondary Index）を事前定義
{
  IndexName: "FeedbackIndex",
  PartitionKey: "feedback",  // 新しいPartition Key
  // 別の視点でデータにアクセス可能
}
```

**重要**: DynamoDBのインデックスは**CDKで事前定義**が必要（後から追加は大変）。

---

### 4. 更新操作

#### SQL
```sql
-- Read → Modify → Write
UPDATE stats
SET executions = executions + 1,
    input_tokens = input_tokens + 100
WHERE user_id = 123 AND date = '2025-01-15';
```

#### DynamoDB
```typescript
// アトミックな更新（Read不要）
await dynamodb.send(new UpdateCommand({
  TableName: "Stats",
  Key: { id: "stats#2025-01-15", userId: "123" },
  UpdateExpression: "ADD executions :one, inputTokens :tokens",
  ExpressionAttributeValues: {
    ":one": 1,
    ":tokens": 100
  }
}));
```

**重要**: DynamoDBの`UpdateExpression`は**アトミック**で、競合状態を回避できる。

---

### 5. トランザクション

#### SQL
```sql
BEGIN;
INSERT INTO shares (share_id, user_id) VALUES ('s1', 'u1');
INSERT INTO share_mappings (user_id, share_id) VALUES ('u1', 's1');
COMMIT;
```

#### DynamoDB
```typescript
await dynamodb.send(new TransactWriteCommand({
  TransactItems: [
    { Put: { TableName: "Shares", Item: { id: "s1", ... } } },
    { Put: { TableName: "Shares", Item: { id: "u1_s1", ... } } }
  ]
}));
```

**重要**: DynamoDBのトランザクションは**最大25項目まで**。

---

## GenUでの実装パターン（5分）

### パターン1: リポジトリ層を使う（推奨）

GenUは**Repository Pattern**を採用しており、DynamoDBの詳細を隠蔽しています。

#### ファイル構成
```
packages/cdk/lambda/repository/
├── common.ts           # テナントコンテキスト抽出（重要）
├── chat.ts             # チャット操作
├── message.ts          # メッセージ操作
├── stats.ts            # 統計集計
├── share.ts            # 共有機能
└── systemContext.ts    # システムコンテキスト
```

#### 使い方（Lambda関数内）

**良い例**:
```typescript
import { listChats, createChat } from './repository/chat';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer?.claims?.sub;

  // リポジトリ層を使う（DynamoDB詳細を知らなくてOK）
  const chats = await listChats(userId, event);

  return {
    statusCode: 200,
    body: JSON.stringify(chats)
  };
};
```

**悪い例**:
```typescript
// ❌ Lambda関数内で直接DynamoDBを操作しない
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export const handler = async (event: APIGatewayProxyEvent) => {
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // 複雑なDynamoDBコードがLambda内に...
};
```

**理由**: リポジトリ層を使うことで、将来的にデータベースを変更する際の影響を最小化できます。

---

### パターン2: テナントコンテキストの自動抽出

GenUはマルチテナント対応なので、**テナントごとに異なるテーブル**を使用します。

#### 仕組み

```typescript
// packages/cdk/lambda/repository/common.ts

// ✅ これを使うだけで、自動的に適切なテーブルにアクセス
const dynamodb = await getTenantDynamoDBDocument(event);
const tableName = getTableName(event);

// 内部で以下を自動判定:
// - Cognito JWTから tenantId を抽出
// - tenantId があれば: ChatHistory-dev-tenant-acme
// - tenantId がなければ: ChatHistoryDev123ABC（デフォルト）
```

#### Lambda関数での使い方

```typescript
import { getTenantDynamoDBDocument, getTableName } from './repository/common';

export const handler = async (event: APIGatewayProxyEvent) => {
  // テナントコンテキストを自動抽出
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  // この時点で、dynamodbは正しいテナントのテーブルにスコープされている
  const result = await dynamodb.send(new QueryCommand({
    TableName: tableName,
    // ...
  }));
};
```

**重要**: この仕組みのおかげで、開発者は**テナントIDを意識せずに**コーディングできます。

---

### パターン3: シングルテーブル設計

GenUは**1つのテーブルに複数のエンティティ**を格納する「シングルテーブル設計」を採用しています。

#### Main Tableの例

| id (Partition Key) | createdDate (Sort Key) | エンティティタイプ | その他の属性 |
|-------------------|----------------------|------------------|-------------|
| `user#alice` | `2025-01-15T10:00:00Z` | Chat | `chatId`, `title` |
| `user#alice` | `2025-01-16T11:00:00Z` | Chat | `chatId`, `title` |
| `chat#456` | `2025-01-15T10:05:00Z#0` | Message | `messageId`, `content` |
| `chat#456` | `2025-01-15T10:05:30Z#1` | Message | `messageId`, `content` |
| `share#789` | `2025-01-15T12:00:00Z` | Share | `userId`, `chatId` |

#### アクセスパターン

```typescript
// チャット一覧を取得
KeyConditionExpression: "id = :userId"
// → id が "user#alice" のすべてのアイテム（チャット）を取得

// メッセージ一覧を取得
KeyConditionExpression: "id = :chatId"
// → id が "chat#456" のすべてのアイテム（メッセージ）を取得
```

**メリット**:
- 関連データを1回のクエリで取得可能
- テーブル数を削減（コスト削減）

**デメリット**:
- スキーマ設計が複雑
- JOIN的な操作はアプリケーション層で実装

**SQLとの対応**:
```sql
-- SQLなら複数テーブルに分ける
CREATE TABLE chats (...);
CREATE TABLE messages (...);
CREATE TABLE shares (...);

-- DynamoDBは1つのテーブルに統合
-- 代わりにid（Partition Key）で区別
```

---

## よく使う操作（2分）

### 1. アイテムを取得（GetItem）

**SQL**:
```sql
SELECT * FROM chats WHERE id = 123;
```

**DynamoDB**:
```typescript
import { findChatById } from './repository/chat';

const chat = await findChatById(userId, chatId, event);
```

**内部実装** (`chat.ts:57`):
```typescript
const res = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :userId",
  FilterExpression: "chatId = :chatId",
  ExpressionAttributeValues: {
    ":userId": `user#${userId}`,
    ":chatId": chatId
  }
}));
```

---

### 2. アイテムを作成（PutItem）

**SQL**:
```sql
INSERT INTO chats (id, user_id, title) VALUES (...);
```

**DynamoDB**:
```typescript
import { createChat } from './repository/chat';

const chat = await createChat(userId, {
  title: "新しいチャット",
  usecase: "chat"
}, event);
```

**内部実装** (`chat.ts:21`):
```typescript
await dynamodb.send(new PutCommand({
  TableName: tableName,
  Item: {
    id: `user#${userId}`,
    createdDate: new Date().toISOString(),
    chatId: `chat#${ulid()}`,
    title: input.title,
    usecase: input.usecase,
    // ...
  }
}));
```

---

### 3. アイテムを更新（UpdateItem）

**SQL**:
```sql
UPDATE chats SET title = 'Updated Title' WHERE id = 123;
```

**DynamoDB**:
```typescript
import { updateChat } from './repository/chat';

await updateChat(userId, chatId, {
  title: "更新されたタイトル"
}, event);
```

**内部実装** (`chat.ts:128`):
```typescript
await dynamodb.send(new UpdateCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: chat.createdDate
  },
  UpdateExpression: "SET title = :title, updatedDate = :updatedDate",
  ExpressionAttributeValues: {
    ":title": input.title,
    ":updatedDate": new Date().toISOString()
  }
}));
```

---

### 4. アイテムを削除（DeleteItem）

**SQL**:
```sql
DELETE FROM chats WHERE id = 123;
```

**DynamoDB**:
```typescript
import { deleteChat } from './repository/chat';

await deleteChat(userId, chatId, event);
```

---

### 5. クエリ（Query）

**SQL**:
```sql
SELECT * FROM chats
WHERE user_id = 123
ORDER BY created_at DESC
LIMIT 100;
```

**DynamoDB**:
```typescript
import { listChats } from './repository/chat';

const chats = await listChats(userId, event, { limit: 100 });
```

**内部実装** (`chat.ts:88`):
```typescript
const res = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  IndexName: undefined,  // プライマリキーを使用
  KeyConditionExpression: "id = :userId",
  ExpressionAttributeValues: {
    ":userId": `user#${userId}`
  },
  ScanIndexForward: false,  // DESC（新しい順）
  Limit: 100
}));
```

---

### 6. バッチ書き込み（BatchWrite）

**SQL**:
```sql
INSERT INTO messages (id, content) VALUES
  (1, 'Hello'),
  (2, 'World');
```

**DynamoDB**:
```typescript
import { batchCreateMessages } from './repository/message';

await batchCreateMessages(
  chatId,
  [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'World' }
  ],
  event
);
```

**内部実装** (`message.ts:207`):
```typescript
await dynamodb.send(new BatchWriteCommand({
  RequestItems: {
    [tableName]: messages.map(msg => ({
      PutRequest: {
        Item: {
          id: `chat#${chatId}`,
          createdDate: `${timestamp}#${sequence}`,
          messageId: `message#${ulid()}`,
          // ...
        }
      }
    }))
  }
}));
```

---

## 次のステップ

### 🎓 さらに学ぶ

1. **[DynamoDBチートシート](./DYNAMODB_CHEATSHEET.md)**: よく使う操作のコピペ可能なコード例
2. **[トラブルシューティングガイド](./DYNAMODB_TROUBLESHOOTING.md)**: よくあるエラーと解決方法
3. **[ワークショップ](./DYNAMODB_WORKSHOP.md)**: 実践的なハンズオン演習（4時間）
4. **[スキーマドキュメント](./DYNAMODB_SCHEMA.md)**: 全テーブルの詳細仕様

### 🛠️ 実践してみる

1. **既存コードを読む**: `packages/cdk/lambda/repository/chat.ts` を開いてコードを読んでみましょう
2. **ローカル開発**: `npm run web:devw` でフロントエンドを起動し、動作を確認
3. **小さな変更**: チャットタイトルの更新など、簡単な機能から始めましょう

### 📚 外部リソース

- **AWS公式**: [DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/latest/developerguide/)（英語）
- **AWS公式**: [ベストプラクティス](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)（英語）
- **動画**: [AWS re:Invent - DynamoDB Deep Dive](https://www.youtube.com/results?search_query=dynamodb+deep+dive)（英語）

---

## 💡 重要なポイントのまとめ

### ✅ 覚えておくべきこと

1. **リポジトリ層を使う**: Lambda関数内で直接DynamoDBを操作しない
2. **Partition Keyは必須**: クエリには必ずPartition Keyを指定
3. **Scanを避ける**: 全テーブルスキャンは低速で高コスト
4. **UpdateExpressionはアトミック**: 統計更新などで活用
5. **テナントコンテキストは自動**: `getTenantDynamoDBDocument()` を使うだけ

### ❌ やってはいけないこと

1. ❌ FilterExpressionだけでクエリ（KeyConditionExpressionを使う）
2. ❌ テーブル全体のScan（必ずPartition Keyを指定）
3. ❌ 複雑なネストしたデータの頻繁な更新（スキーマ設計を見直す）
4. ❌ トランザクションの乱用（最大25項目、コストが高い）
5. ❌ GSIの後付け追加（既存データの再インデックスが必要）

---

## 🆘 困ったときは

1. **[トラブルシューティングガイド](./DYNAMODB_TROUBLESHOOTING.md)**を参照
2. **CloudWatch Logs**でエラーメッセージを確認
3. **既存コード**を検索（`packages/cdk/lambda/repository/` 内）
4. チーム内の経験者に相談

---

**次へ**: [DynamoDBチートシート →](./DYNAMODB_CHEATSHEET.md)
