# DynamoDB チートシート

**対象**: GenU開発者向け、すぐに使えるコード例集

このチートシートは、GenUでDynamoDBを使う際の**コピペ可能なコード例**を集めたものです。

---

## 📋 目次

1. [基本操作](#基本操作)
2. [リポジトリ層の使い方](#リポジトリ層の使い方)
3. [UpdateExpression パターン集](#updateexpression-パターン集)
4. [Query パターン集](#query-パターン集)
5. [エラーハンドリング](#エラーハンドリング)
6. [テストコード](#テストコード)

---

## 基本操作

### テナントコンテキストの取得

```typescript
import { getTenantDynamoDBDocument, getTableName } from './repository/common';
import { APIGatewayProxyEvent } from 'aws-lambda';

export const handler = async (event: APIGatewayProxyEvent) => {
  // テナント専用のDynamoDBクライアントとテーブル名を取得
  const dynamodb = await getTenantDynamoDBDocument(event);
  const tableName = getTableName(event);

  // これで準備完了！
};
```

---

### アイテムを1件取得（GetItem）

```typescript
import { GetCommand } from '@aws-sdk/lib-dynamodb';

// Key が完全に一致するアイテムを取得
const result = await dynamodb.send(new GetCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: "2025-01-15T10:00:00.000Z"
  }
}));

const item = result.Item;
```

**いつ使う**: Partition Key と Sort Key の両方が分かっている場合

---

### アイテムを作成（PutItem）

```typescript
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

await dynamodb.send(new PutCommand({
  TableName: tableName,
  Item: {
    id: `user#${userId}`,
    createdDate: new Date().toISOString(),
    chatId: `chat#${ulid()}`,
    title: "新しいチャット",
    usecase: "chat",
    updatedDate: new Date().toISOString()
  }
}));
```

**いつ使う**: 新しいアイテムを作成する場合

---

### アイテムを更新（UpdateItem）

```typescript
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

await dynamodb.send(new UpdateCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: chat.createdDate  // 既存のSort Keyを使用
  },
  UpdateExpression: "SET title = :title, updatedDate = :updatedDate",
  ExpressionAttributeValues: {
    ":title": "更新されたタイトル",
    ":updatedDate": new Date().toISOString()
  }
}));
```

**いつ使う**: 既存アイテムの一部の属性を更新する場合

---

### アイテムを削除（DeleteItem）

```typescript
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';

await dynamodb.send(new DeleteCommand({
  TableName: tableName,
  Key: {
    id: `user#${userId}`,
    createdDate: chat.createdDate
  }
}));
```

**いつ使う**: アイテムを削除する場合

---

### クエリ（Query）

```typescript
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :userId",
  ExpressionAttributeValues: {
    ":userId": `user#${userId}`
  },
  ScanIndexForward: false,  // false = 降順（新しい順）
  Limit: 100
}));

const items = result.Items || [];
const lastKey = result.LastEvaluatedKey;  // ページネーション用
```

**いつ使う**: Partition Key が分かっていて、複数のアイテムを取得する場合

---

### バッチ取得（BatchGet）

```typescript
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const result = await dynamodb.send(new BatchGetCommand({
  RequestItems: {
    [tableName]: {
      Keys: [
        { id: `stats#2025-01-15`, userId: "user1" },
        { id: `stats#2025-01-16`, userId: "user1" },
        { id: `stats#2025-01-17`, userId: "user1" }
      ]
    }
  }
}));

const items = result.Responses?.[tableName] || [];
```

**いつ使う**: 複数の異なるKeyのアイテムを一度に取得する場合（最大100件）

---

### バッチ書き込み（BatchWrite）

```typescript
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

await dynamodb.send(new BatchWriteCommand({
  RequestItems: {
    [tableName]: [
      {
        PutRequest: {
          Item: {
            id: `chat#${chatId}`,
            createdDate: `${timestamp}#0`,
            messageId: `message#${ulid()}`,
            role: 'user',
            content: 'Hello'
          }
        }
      },
      {
        PutRequest: {
          Item: {
            id: `chat#${chatId}`,
            createdDate: `${timestamp}#1`,
            messageId: `message#${ulid()}`,
            role: 'assistant',
            content: 'Hi there!'
          }
        }
      }
    ]
  }
}));
```

**いつ使う**: 複数のアイテムを一度に作成/削除する場合（最大25件）

---

### トランザクション（TransactWrite）

```typescript
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

await dynamodb.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: tableName,
        Item: {
          id: `share#${shareId}`,
          createdDate: new Date().toISOString(),
          userId: `user#${userId}`,
          chatId: `chat#${chatId}`
        }
      }
    },
    {
      Put: {
        TableName: tableName,
        Item: {
          id: `user#${userId}_chat#${chatId}`,
          createdDate: new Date().toISOString(),
          shareId: `share#${shareId}`
        }
      }
    }
  ]
}));
```

**いつ使う**: 複数の操作をアトミックに実行したい場合（最大25項目）

---

## リポジトリ層の使い方

### チャット操作

```typescript
import {
  listChats,
  findChatById,
  createChat,
  updateChat,
  deleteChat
} from './repository/chat';

// チャット一覧取得
const chats = await listChats(userId, event, { limit: 100 });

// 特定チャット取得
const chat = await findChatById(userId, chatId, event);

// チャット作成
const newChat = await createChat(userId, {
  title: "新しいチャット",
  usecase: "chat"
}, event);

// チャット更新
await updateChat(userId, chatId, {
  title: "更新されたタイトル"
}, event);

// チャット削除（メッセージも一緒に削除）
await deleteChat(userId, chatId, event);
```

---

### メッセージ操作

```typescript
import {
  listMessages,
  batchCreateMessages,
  batchDeleteMessages,
  updateMessageFeedback
} from './repository/message';

// メッセージ一覧取得
const messages = await listMessages(chatId, event);

// メッセージ一括作成
await batchCreateMessages(chatId, [
  {
    role: 'user',
    content: 'ユーザーの質問',
    userId: `user#${userId}`,
    usecase: 'chat',
    llmType: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
  },
  {
    role: 'assistant',
    content: 'アシスタントの回答',
    userId: `user#${userId}`,
    usecase: 'chat',
    llmType: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    feedback: 'none',
    metadata: {
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0
      }
    }
  }
], event);

// フィードバック更新
await updateMessageFeedback(
  chatId,
  messageId,
  'good',  // 'good' | 'bad'
  [],      // reasons (bad の場合に使用)
  '',      // detailedFeedback
  event
);
```

---

### 統計操作

```typescript
import { getStats } from './repository/stats';

// 日付範囲の統計取得
const stats = await getStats({
  userId,
  startDate: '2025-01-01',
  endDate: '2025-01-31'
}, event);

// statsの構造
// {
//   executions: { overall: 100, "model#claude-3-5": 50, ... },
//   inputTokens: { overall: 10000, "model#claude-3-5": 5000, ... },
//   outputTokens: { overall: 20000, ... },
//   ...
// }
```

**Note**: 統計の更新は `batchCreateMessages` 内で自動的に行われます。

---

### 共有操作

```typescript
import {
  createShareId,
  findShareByChatId,
  findShareByShareId,
  deleteShareById
} from './repository/share';

// 共有リンク作成
const shareId = await createShareId(userId, chatId, event);
// 返り値: "share#01HQXXX..."

// ユーザー+チャットIDから共有情報取得
const share = await findShareByChatId(userId, chatId, event);

// 共有IDから元のチャット情報取得
const shareInfo = await findShareByShareId(shareId, event);
// { userId: "user#123", chatId: "chat#456" }

// 共有削除
await deleteShareById(userId, chatId, event);
```

---

### システムコンテキスト操作

```typescript
import {
  listSystemContexts,
  findSystemContextById,
  createSystemContext,
  updateSystemContext,
  deleteSystemContext
} from './repository/systemContext';

// システムコンテキスト一覧
const contexts = await listSystemContexts(userId, event);

// 作成
const newContext = await createSystemContext(userId, {
  systemContext: "あなたは親切なアシスタントです。",
  systemContextTitle: "親切モード"
}, event);

// 更新
await updateSystemContext(userId, systemContextId, {
  systemContext: "更新されたコンテキスト",
  systemContextTitle: "更新されたタイトル"
}, event);

// 削除
await deleteSystemContext(userId, systemContextId, event);
```

---

## UpdateExpression パターン集

### パターン1: 属性を設定（SET）

```typescript
// 1つの属性を設定
UpdateExpression: "SET title = :title"

// 複数の属性を設定
UpdateExpression: "SET title = :title, updatedDate = :updatedDate"

// ネストした属性を設定
UpdateExpression: "SET metadata.#field = :value"
```

---

### パターン2: 数値をインクリメント（ADD）

```typescript
// 単純なインクリメント
UpdateExpression: "ADD executions :one"
ExpressionAttributeValues: { ":one": 1 }

// 複数の数値を同時にインクリメント
UpdateExpression: "ADD executions :one, inputTokens :tokens"
ExpressionAttributeValues: {
  ":one": 1,
  ":tokens": 100
}

// 存在しない場合は0として扱う
UpdateExpression: "SET executions = if_not_exists(executions, :zero) + :one"
ExpressionAttributeValues: {
  ":zero": 0,
  ":one": 1
}
```

---

### パターン3: ネストしたオブジェクトの更新

```typescript
// ネストしたフィールドの更新
UpdateExpression: "SET executions.#overall = :value, executions.#modelKey = :value2"
ExpressionAttributeNames: {
  "#overall": "overall",
  "#modelKey": "model#claude-3-5-sonnet"  // 予約語や特殊文字を含む場合
}
ExpressionAttributeValues: {
  ":value": 100,
  ":value2": 50
}
```

**重要**: `#` で始まる属性名は `ExpressionAttributeNames` で定義が必要

---

### パターン4: リストに追加（list_append）

```typescript
// リストの末尾に追加
UpdateExpression: "SET reasons = list_append(if_not_exists(reasons, :empty_list), :new_item)"
ExpressionAttributeValues: {
  ":empty_list": [],
  ":new_item": ["新しい理由"]
}
```

---

### パターン5: 属性を削除（REMOVE）

```typescript
// 属性を削除
UpdateExpression: "REMOVE feedback, reasons"
```

---

### パターン6: 条件付き更新

```typescript
// 特定の条件を満たす場合のみ更新
UpdateExpression: "SET title = :title"
ConditionExpression: "attribute_exists(id)"  // idが存在する場合のみ
ExpressionAttributeValues: {
  ":title": "新しいタイトル"
}

// 楽観的ロック（バージョン番号チェック）
ConditionExpression: "version = :currentVersion"
UpdateExpression: "SET title = :title, version = :newVersion"
ExpressionAttributeValues: {
  ":currentVersion": 1,
  ":newVersion": 2,
  ":title": "更新"
}
```

---

## Query パターン集

### パターン1: 完全一致クエリ

```typescript
KeyConditionExpression: "id = :userId"
ExpressionAttributeValues: {
  ":userId": `user#${userId}`
}
```

---

### パターン2: 範囲クエリ

```typescript
// 特定の日付以降
KeyConditionExpression: "id = :userId AND createdDate >= :date"
ExpressionAttributeValues: {
  ":userId": `user#${userId}`,
  ":date": "2025-01-01T00:00:00.000Z"
}

// 日付範囲
KeyConditionExpression: "id = :userId AND createdDate BETWEEN :startDate AND :endDate"
ExpressionAttributeValues: {
  ":userId": `user#${userId}`,
  ":startDate": "2025-01-01T00:00:00.000Z",
  ":endDate": "2025-01-31T23:59:59.999Z"
}

// 前方一致
KeyConditionExpression: "id = :userId AND begins_with(createdDate, :prefix)"
ExpressionAttributeValues: {
  ":userId": `user#${userId}`,
  ":prefix": "2025-01"
}
```

---

### パターン3: FilterExpression（追加フィルタ）

```typescript
KeyConditionExpression: "id = :userId"
FilterExpression: "chatId = :chatId"  // KeyCondition後にフィルタ
ExpressionAttributeValues: {
  ":userId": `user#${userId}`,
  ":chatId": "chat#123"
}
```

**注意**: FilterExpressionはKeyCondition後に適用されるため、パフォーマンスが悪い。可能な限りKeyConditionで絞り込む。

---

### パターン4: GSIを使ったクエリ

```typescript
// FeedbackIndexを使用
IndexName: "FeedbackIndex"
KeyConditionExpression: "feedback = :feedback"
ExpressionAttributeValues: {
  ":feedback": "good"
}
```

---

### パターン5: ページネーション

```typescript
const result = await dynamodb.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: "id = :userId",
  ExpressionAttributeValues: {
    ":userId": `user#${userId}`
  },
  Limit: 100,
  ExclusiveStartKey: lastEvaluatedKey  // 前回のクエリから取得
}));

const items = result.Items || [];
const nextKey = result.LastEvaluatedKey;  // 次のページ用

// nextKeyをBase64エンコードしてクライアントに返す
const encodedKey = nextKey
  ? Buffer.from(JSON.stringify(nextKey)).toString('base64')
  : undefined;
```

---

### パターン6: ソート順の変更

```typescript
// 昇順（古い順）
ScanIndexForward: true

// 降順（新しい順）- デフォルト
ScanIndexForward: false
```

---

## エラーハンドリング

### 基本パターン

```typescript
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

try {
  await dynamodb.send(new PutCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(id)"  // 重複チェック
  }));
} catch (error) {
  if (error instanceof ConditionalCheckFailedException) {
    // 条件が満たされなかった（既に存在する）
    throw new Error('アイテムは既に存在します');
  }

  // その他のエラー
  console.error('DynamoDB Error:', error);
  throw error;
}
```

---

### よくあるエラーと対処法

```typescript
// 1. ResourceNotFoundException - テーブルが存在しない
catch (error) {
  if (error.name === 'ResourceNotFoundException') {
    console.error('テーブルが存在しません:', tableName);
    // テーブル名を確認、CDKデプロイを確認
  }
}

// 2. ValidationException - パラメータが不正
catch (error) {
  if (error.name === 'ValidationException') {
    console.error('パラメータが不正です:', error.message);
    // KeyConditionExpression, UpdateExpressionを確認
  }
}

// 3. ProvisionedThroughputExceededException - スロットリング
catch (error) {
  if (error.name === 'ProvisionedThroughputExceededException') {
    // オンデマンドモードでは発生しないはず
    console.error('スロットリングが発生しました');
    // 指数バックオフでリトライ
  }
}

// 4. ItemCollectionSizeLimitExceededException - 10GB制限
catch (error) {
  if (error.name === 'ItemCollectionSizeLimitExceededException') {
    console.error('Partition Keyあたり10GBを超えました');
    // スキーマ設計を見直す必要あり
  }
}
```

---

### リトライロジック

```typescript
import { setTimeout } from 'timers/promises';

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // 指数バックオフ: 100ms, 200ms, 400ms
      const delay = 100 * Math.pow(2, i);
      console.log(`リトライ ${i + 1}/${maxRetries} (${delay}ms後)`);
      await setTimeout(delay);
    }
  }
  throw new Error('予期しないエラー');
}

// 使用例
const result = await retryWithBackoff(() =>
  dynamodb.send(new QueryCommand({ ... }))
);
```

---

## テストコード

### ユニットテスト（モック使用）

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { listChats } from './repository/chat';

const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('listChats', () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  it('ユーザーのチャット一覧を取得できる', async () => {
    // モックの設定
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          id: 'user#123',
          createdDate: '2025-01-15T10:00:00.000Z',
          chatId: 'chat#456',
          title: 'テストチャット'
        }
      ]
    });

    // テスト実行
    const result = await listChats('user#123', mockEvent);

    // アサーション
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('テストチャット');
  });
});
```

---

### 統合テスト（実際のDynamoDB使用）

```typescript
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createChat, findChatById, deleteChat } from './repository/chat';

describe('Chat Integration Tests', () => {
  const userId = 'test-user-123';
  let chatId: string;

  it('チャットを作成できる', async () => {
    const chat = await createChat(userId, {
      title: 'テストチャット',
      usecase: 'chat'
    }, mockEvent);

    expect(chat.chatId).toBeDefined();
    chatId = chat.chatId;
  });

  it('作成したチャットを取得できる', async () => {
    const chat = await findChatById(userId, chatId, mockEvent);
    expect(chat).toBeDefined();
    expect(chat.title).toBe('テストチャット');
  });

  afterAll(async () => {
    // クリーンアップ
    if (chatId) {
      await deleteChat(userId, chatId, mockEvent);
    }
  });
});
```

---

## 📚 関連ドキュメント

- **[クイックスタートガイド](./DYNAMODB_QUICKSTART.md)**: DynamoDB基礎を学ぶ
- **[スキーマドキュメント](./DYNAMODB_SCHEMA.md)**: 全テーブルの詳細仕様
- **[トラブルシューティング](./DYNAMODB_TROUBLESHOOTING.md)**: よくある問題と解決方法
- **[ワークショップ](./DYNAMODB_WORKSHOP.md)**: 実践的なハンズオン演習

---

## 🔍 コード検索のコツ

既存のコード例を探す場合：

```bash
# リポジトリ層のファイルを検索
grep -r "QueryCommand" packages/cdk/lambda/repository/

# 特定の操作を検索
grep -r "UpdateExpression" packages/cdk/lambda/repository/

# エラーハンドリングの例を検索
grep -r "try.*catch" packages/cdk/lambda/repository/
```

---

このチートシートを印刷して手元に置いておくと便利です！
