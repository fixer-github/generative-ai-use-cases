# GenU DynamoDB スキーマドキュメント

本ドキュメントは、GenU（Generative AI Use Cases）プラットフォームで使用されているすべてのDynamoDBテーブルのスキーマと、データアクセスパターンを詳細に説明します。

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [テーブル一覧](#テーブル一覧)
3. [詳細スキーマ定義](#詳細スキーマ定義)
   - [Control Plane テーブル](#control-plane-テーブル)
   - [Per-Tenant テーブル](#per-tenant-テーブル)
4. [テナントコンテキスト抽出パターン](#テナントコンテキスト抽出パターン)
5. [データ分離戦略](#データ分離戦略)
6. [主要機能](#主要機能)
7. [サマリー統計](#サマリー統計)

---

## アーキテクチャ概要

GenUは**マルチテナントアーキテクチャ**を採用しており、2つのデプロイメントパターンをサポートしています：

### 1. Control Plane（コントロールプレーン）
- **用途**: シングルテナント環境、またはデフォルトテナント
- **特徴**: 共有のDynamoDBテーブルを使用
- **デプロイ**: すべての環境でデフォルトで作成される

### 2. Data Plane（データプレーン）
- **用途**: マルチテナント環境
- **特徴**: テナントごとに完全に分離されたDynamoDBテーブル
- **デプロイ**: マルチテナント機能が有効な場合のみ作成される

### アーキテクチャの利点
- **データ分離**: テナント間でデータが完全に分離され、セキュリティが向上
- **スケーラビリティ**: テナントごとにリソースをスケール可能
- **柔軟性**: シングルテナントとマルチテナントの両方をサポート
- **コスト最適化**: テナント単位でリソースを管理・最適化可能

---

## テーブル一覧

### Control Plane テーブル（共有）

| # | テーブル名 | 用途 | 必須 |
|---|-----------|------|------|
| 1 | [Main Table](#1-main-tablecontrol-plane) | チャット、メッセージ、共有、システムコンテキスト | ✅ |
| 2 | [Stats Table](#2-stats-tablecontrol-plane) | トークン使用統計 | ✅ |
| 3 | [Tenants Table](#3-tenants-tablecontrol-plane) | テナント登録情報 | マルチテナント時のみ |
| 4 | [UseCaseBuilder Table](#4-usecasebuilder-tablecontrol-plane) | カスタムユースケース定義 | ✅ |

### Per-Tenant テーブル（分離）

| # | テーブル名 | 用途 | 必須 |
|---|-----------|------|------|
| 5 | [ChatHistory Table](#5-tenant-chathistory-tableper-tenant) | テナント専用のチャット履歴 | マルチテナント時 |
| 6 | [TokenUsageStats Table](#6-tenant-tokenusagestats-tableper-tenant) | テナント専用の統計 | マルチテナント時 |
| 7 | [UseCaseBuilder Table](#7-tenant-usecasebuilder-tableper-tenant) | テナント専用のユースケース | マルチテナント時 |
| 8 | [PPTX Templates Table](#8-pptx-templates-tableper-tenant) | PowerPointテンプレート | PPTX機能有効時 |
| 9 | [PPTX Generations Table](#9-pptx-generations-tableper-tenant) | PowerPoint生成履歴 | PPTX機能有効時 |

---

## 詳細スキーマ定義

### Control Plane テーブル

#### 1. Main Table（Control Plane）

**目的**: チャット、メッセージ、共有リンク、システムコンテキストの一元管理

**実装ファイル**: [`packages/cdk/lib/construct/database.ts:124`](../../packages/cdk/lib/construct/database.ts#L124)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Partition Key** | `id` (STRING) |
| **Sort Key** | `createdDate` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS所有キー（デフォルト） |
| **削除ポリシー** | 環境依存（開発: DESTROY / 本番: RETAIN） |

##### Global Secondary Indexes

###### FeedbackIndex
- **Partition Key**: `feedback` (STRING)
- **用途**: ユーザーフィードバック（good/bad）でメッセージを検索

##### 格納データエンティティ

このテーブルは、複数の異なるエンティティタイプを格納する**シングルテーブルデザイン**を採用しています。

###### A. Chat Records（チャット記録）

**用途**: ユーザーのチャットセッション情報

**スキーマ**:
```typescript
{
  id: "user#<userId>",                    // PK: ユーザー識別子
  createdDate: "<timestamp>",             // SK: 作成タイムスタンプ（ISO 8601形式）
  chatId: "chat#<uuid>",                  // ユニークなチャット識別子
  usecase: string,                        // ユースケースタイプ（例: "chat", "rag", "agent"）
  title: string,                          // チャットタイトル（ユーザーが設定可能）
  updatedDate: string                     // 最終更新タイムスタンプ
}
```

**実装**: [`packages/cdk/lambda/repository/chat.ts`](../../packages/cdk/lambda/repository/chat.ts)

###### B. Message Records（メッセージ記録）

**用途**: チャット内の個々のメッセージ（ユーザー・アシスタント・システム）

**スキーマ**:
```typescript
{
  id: "chat#<chatId>",                    // PK: チャット識別子
  createdDate: "<timestamp>#<sequence>",  // SK: タイムスタンプ + シーケンス番号
  messageId: string,                      // ユニークなメッセージID
  role: "user" | "assistant" | "system",  // メッセージロール
  content: string,                        // メッセージテキスト内容
  trace?: string,                         // トレースデータ（RAG/Agent実行時の詳細情報）
  extraData?: ExtraData[],                // 画像/動画/ファイル添付データ
  userId: "user#<userId>",                // メッセージ所有者のユーザーID
  feedback: "good" | "bad" | "none",      // ユーザーフィードバック
  reasons?: string[],                     // フィードバック理由（ネガティブフィードバックの場合）
  detailedFeedback?: string,              // 詳細フィードバックテキスト
  usecase: string,                        // ユースケースタイプ
  llmType: string,                        // 使用されたモデルID（例: "anthropic.claude-3-5-sonnet-20241022-v2:0"）
  metadata?: {
    usage: {
      inputTokens: number,                // 入力トークン数
      outputTokens: number,               // 出力トークン数
      cacheReadInputTokens: number,       // キャッシュ読み取りトークン数
      cacheWriteInputTokens: number       // キャッシュ書き込みトークン数
    }
  }
}
```

**実装**: [`packages/cdk/lambda/repository/message.ts`](../../packages/cdk/lambda/repository/message.ts)

**トークン使用量の記録**: メッセージ保存時に自動的にトークン使用量が統計テーブルに集計されます。

###### C. Share Records（共有記録）

**用途**: チャット共有機能の双方向マッピング

**スキーマ（順方向マッピング）**: User + Chat → ShareId
```typescript
{
  id: "user#<userId>_chat#<chatId>",     // PK: 複合識別子（ユーザー_チャット）
  createdDate: "<timestamp>",             // SK: 作成タイムスタンプ
  shareId: "share#<uuid>"                 // 共有リンク識別子
}
```

**スキーマ（逆方向マッピング）**: ShareId → User + Chat
```typescript
{
  id: "share#<uuid>",                     // PK: 共有識別子
  createdDate: "<timestamp>",             // SK: 作成タイムスタンプ
  userId: "user#<userId>",                // 元の所有者
  chatId: "chat#<chatId>"                 // 共有されたチャット
}
```

**実装**: [`packages/cdk/lambda/repository/share.ts`](../../packages/cdk/lambda/repository/share.ts)

**設計理由**: 双方向マッピングにより、以下の両方のクエリを効率的に実行可能：
- ユーザー + チャットIDから共有リンクを取得
- 共有リンクから元のチャット情報を取得

###### D. SystemContext Records（システムコンテキスト記録）

**用途**: ユーザーが定義したシステムプロンプト・コンテキスト

**スキーマ**:
```typescript
{
  id: "systemContext#<userId>",           // PK: ユーザー識別子
  createdDate: "<timestamp>",             // SK: 作成タイムスタンプ
  systemContextId: "systemContext#<uuid>", // ユニークなコンテキストID
  systemContext: string,                  // コンテキスト内容（プロンプトテキスト）
  systemContextTitle: string              // コンテキストタイトル
}
```

**実装**: [`packages/cdk/lambda/repository/systemContext.ts`](../../packages/cdk/lambda/repository/systemContext.ts)

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | ユーザーのチャット一覧取得 | Query: `id = "user#<userId>"`, Sort: `createdDate` DESC | チャット履歴画面 |
| 2 | 特定チャット検索 | Query: `id = "user#<userId>"` + Filter: `chatId` | チャット詳細画面 |
| 3 | チャット内メッセージ一覧 | Query: `id = "chat#<chatId>"`, Sort: `createdDate` ASC | メッセージ表示 |
| 4 | フィードバック付きメッセージ検索 | Query FeedbackIndex: `feedback = "good" OR "bad"` | フィードバック分析 |
| 5 | User+ChatからShare検索 | Query: `id = "user#<userId>_chat#<chatId>"` | 共有リンク生成 |
| 6 | ShareIdからChat検索 | Query: `id = "share#<uuid>"` | 共有リンクアクセス |
| 7 | システムコンテキスト一覧 | Query: `id = "systemContext#<userId>"` | コンテキスト選択画面 |

---

#### 2. Stats Table（Control Plane）

**目的**: トークン使用量とモデル実行回数の統計集計

**実装ファイル**: [`packages/cdk/lib/construct/database.ts:139`](../../packages/cdk/lib/construct/database.ts#L139)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Partition Key** | `id` (STRING) - フォーマット: `stats#<YYYY-MM-DD>` |
| **Sort Key** | `userId` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS所有キー（デフォルト） |

##### レコード構造

**スキーマ**:
```typescript
{
  id: "stats#<YYYY-MM-DD>",               // PK: 日付ベースのパーティション
  userId: string,                         // SK: ユーザー識別子
  date: "YYYY-MM-DD",                     // 日付文字列（冗長だが明示的）

  // 実行回数（モデル呼び出し回数）
  executions: {
    overall: number,                      // 総実行回数
    "model#<modelId>": number,            // モデルごとの実行回数
    "usecase#<usecase>": number           // ユースケースごとの実行回数
  },

  // 入力トークン数
  inputTokens: {
    overall: number,                      // 総入力トークン数
    "model#<modelId>": number,            // モデルごとのトークン数
    "usecase#<usecase>": number           // ユースケースごとのトークン数
  },

  // 出力トークン数
  outputTokens: {
    overall: number,                      // 総出力トークン数
    "model#<modelId>": number,
    "usecase#<usecase>": number
  },

  // キャッシュ読み取りトークン数（Prompt Caching機能）
  cacheReadInputTokens: {
    overall: number,
    "model#<modelId>": number,
    "usecase#<usecase>": number
  },

  // キャッシュ書き込みトークン数（Prompt Caching機能）
  cacheWriteInputTokens: {
    overall: number,
    "model#<modelId>": number,
    "usecase#<usecase>": number
  }
}
```

**実装**: [`packages/cdk/lambda/repository/stats.ts`](../../packages/cdk/lambda/repository/stats.ts)

##### 統計更新メカニズム

統計は**アトミック更新**により、以下の方法で増分されます：

```typescript
// DynamoDB UpdateCommand を使用
{
  UpdateExpression: "ADD executions.overall :inc, executions.#model :inc",
  ExpressionAttributeValues: {
    ":inc": 1  // インクリメント値
  }
}
```

**メリット**:
- 競合状態を回避（Read-Modify-Write不要）
- 高スループット（並行更新が安全）
- データの一貫性保証

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | 特定日のユーザー統計取得 | Query: `id = "stats#<YYYY-MM-DD>", userId = "<userId>"` | 日次レポート |
| 2 | 日付範囲の統計集計 | BatchGetItem: 複数の日付キー | 週次/月次レポート |
| 3 | 全ユーザーの統計取得 | Query: `id = "stats#<YYYY-MM-DD>"` | 管理者ダッシュボード |

---

#### 3. Tenants Table（Control Plane）

**目的**: マルチテナント環境でのテナント登録情報管理

**実装ファイル**: [`packages/cdk/lib/construct/tenant-manager.ts:37`](../../packages/cdk/lib/construct/tenant-manager.ts#L37)

**注意**: このテーブルは、マルチテナント機能が有効な場合のみ作成されます。

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `Tenants-<environment>` |
| **Partition Key** | `tenantId` (STRING) |
| **Sort Key** | なし（シンプルキー） |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS_MANAGED（KMS管理キー） |
| **ポイントインタイムリカバリ** | 有効 |

##### レコード構造

**スキーマ**:
```typescript
{
  tenantId: string,                       // PK: ユニークなテナント識別子
  tenantName?: string,                    // テナント表示名（オプション）
  createdAt?: string,                     // 作成タイムスタンプ（ISO 8601形式）
  status?: "active" | "suspended",        // テナントステータス
  metadata?: Record<string, any>          // 追加のテナントメタデータ（拡張可能）
}
```

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | テナント情報取得 | GetItem: `tenantId` | テナント設定画面 |
| 2 | 新規テナント登録 | PutItem | テナントオンボーディング |
| 3 | 全テナント一覧 | Scan（ページネーション付き） | 管理者ダッシュボード |
| 4 | テナントステータス更新 | UpdateItem: `status` | テナント停止/再開 |

##### テナント管理API

- **登録エンドポイント**: セルフサービスAPIでテナントを自動登録
- **分離保証**: 各テナントは独立したDynamoDBテーブルセットを取得
- **リソース命名**: テナントIDを含むテーブル名（例: `ChatHistory-dev-tenant-acme`）

---

#### 4. UseCaseBuilder Table（Control Plane）

**目的**: ユーザーがカスタム定義したユースケース（プロンプトテンプレート）の管理

**実装ファイル**: [`packages/cdk/lib/construct/use-case-builder.ts:28`](../../packages/cdk/lib/construct/use-case-builder.ts#L28)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Partition Key** | `id` (STRING) |
| **Sort Key** | `dataType` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS所有キー（デフォルト） |

##### Global Secondary Indexes

###### UseCaseIdIndexName
- **Partition Key**: `useCaseId` (STRING)
- **Sort Key**: `dataType` (STRING)
- **Projection**: ALL（すべての属性）
- **用途**: ユースケースIDから定義を高速検索

##### 格納データエンティティ

このテーブルもシングルテーブルデザインを採用し、`dataType` で異なるエンティティを区別します。

###### A. UseCase Definition（ユースケース定義）

**スキーマ**:
```typescript
{
  id: "user#<userId>",                    // PK: ユーザー識別子
  dataType: "usecase",                    // SK: データタイプ識別子
  useCaseId: "usecase#<uuid>",            // ユニークなユースケースID
  title: string,                          // ユースケースタイトル
  description?: string,                   // 説明文
  promptTemplate: string,                 // 変数付きプロンプトテンプレート（例: "{{input}}を要約してください"）
  inputExamples?: UseCaseInputExample[],  // 入力例のリスト
  fixedModelId?: string,                  // 固定モデル選択（指定がない場合はユーザーが選択可能）
  fileUpload?: boolean,                   // ファイルアップロード有効フラグ
  isShared: boolean                       // 他ユーザーとの共有フラグ
}
```

###### B. Favorite Record（お気に入り記録）

**スキーマ**:
```typescript
{
  id: "user#<userId>",                    // PK: ユーザー識別子
  dataType: "favorite#<useCaseId>",       // SK: お気に入りマーカー
  useCaseId: string                       // 参照されるユースケースID
}
```

###### C. Recently Used Record（最近使用記録）

**スキーマ**:
```typescript
{
  id: "user#<userId>",                    // PK: ユーザー識別子
  dataType: "recent#<useCaseId>",         // SK: 最近使用マーカー
  useCaseId: string,                      // 参照されるユースケースID
  lastUsedAt: string                      // 最終使用タイムスタンプ
}
```

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | ユーザーのユースケース一覧 | Query: `id = "user#<userId>", dataType = "usecase"` | ユースケース選択画面 |
| 2 | お気に入り一覧 | Query: `id = "user#<userId>", dataType begins_with "favorite#"` | お気に入りタブ |
| 3 | 最近使用一覧 | Query: `id = "user#<userId>", dataType begins_with "recent#"` | 最近使用タブ |
| 4 | IDでユースケース取得 | Query UseCaseIdIndexName: `useCaseId, dataType = "usecase"` | ユースケース実行 |
| 5 | 共有ユースケース一覧 | Scan: Filter `isShared = true` | コミュニティテンプレート |

---

### Per-Tenant テーブル

Per-Tenantテーブルは、各テナントに対して完全に分離されたテーブルセットを提供します。スキーマはControl Planeテーブルと同一ですが、**テーブル名にテナントIDが含まれる**点が異なります。

#### 5. Tenant ChatHistory Table（Per-Tenant）

**目的**: テナント専用のチャット履歴・メッセージ・共有・システムコンテキスト

**実装ファイル**: [`packages/cdk/lib/construct/tenant-dynamodb.ts:32`](../../packages/cdk/lib/construct/tenant-dynamodb.ts#L32)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `ChatHistory-<environment>-tenant-<tenantId>` |
| **Partition Key** | `id` (STRING) |
| **Sort Key** | `createdDate` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS所有キー（デフォルト） |
| **削除ポリシー** | DESTROY（開発）/ RETAIN（本番） |
| **タグ** | `TenantId: <tenantId>`, `Environment: <env>` |

##### Global Secondary Indexes

- **FeedbackIndex**（Control Plane Main Tableと同一）

##### スキーマ

Control Plane [Main Table](#1-main-tablecontrol-plane) と完全に同一のスキーマを使用します。

**格納エンティティ**:
- Chat Records
- Message Records
- Share Records
- SystemContext Records

##### テナント分離の実装

各テナントは**独立したテーブル**を持つため、以下の利点があります：

- **パフォーマンス分離**: 大量データを持つテナントが他のテナントに影響を与えない
- **コスト可視化**: テナントごとのDynamoDBコストを正確に追跡可能
- **データ主権**: テナントごとに異なるリージョンへのデプロイも可能（拡張性）
- **削除の容易性**: テナント解約時にテーブルを削除するだけで完全にデータ削除

---

#### 6. Tenant TokenUsageStats Table（Per-Tenant）

**目的**: テナント専用のトークン使用統計

**実装ファイル**: [`packages/cdk/lib/construct/tenant-dynamodb.ts:52`](../../packages/cdk/lib/construct/tenant-dynamodb.ts#L52)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `TokenUsageStats-<environment>-tenant-<tenantId>` |
| **Partition Key** | `id` (STRING) - フォーマット: `stats#<YYYY-MM-DD>` |
| **Sort Key** | `userId` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **削除ポリシー** | DESTROY（開発）/ RETAIN（本番） |

##### Global Secondary Indexes

###### MonthIndex（テナント専用の追加機能）
- **Partition Key**: `month` (STRING) - フォーマット: `YYYY-MM`
- **Sort Key**: `userId` (STRING)
- **用途**: 月次統計レポートの高速集計

**設計理由**: マルチテナント環境では、テナントごとの月次課金レポートが必要なため、月次インデックスを追加。

##### スキーマ

Control Plane [Stats Table](#2-stats-tablecontrol-plane) と同一のスキーマ。

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | 日次統計取得 | Query: `id = "stats#<YYYY-MM-DD>"` | 日次ダッシュボード |
| 2 | 月次統計集計 | Query MonthIndex: `month = "YYYY-MM"` | 請求書生成 |
| 3 | ユーザー別月次統計 | Query MonthIndex: `month = "YYYY-MM", userId = "<userId>"` | ユーザー別課金 |

---

#### 7. Tenant UseCaseBuilder Table（Per-Tenant）

**目的**: テナント専用のカスタムユースケース定義

**実装ファイル**: [`packages/cdk/lib/construct/tenant-dynamodb.ts:72`](../../packages/cdk/lib/construct/tenant-dynamodb.ts#L72)

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `UseCaseBuilder-<environment>-tenant-<tenantId>` |
| **Partition Key** | `id` (STRING) |
| **Sort Key** | `dataType` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **削除ポリシー** | DESTROY（開発）/ RETAIN（本番） |

##### Global Secondary Indexes

- **UseCaseIdIndexName**（Control Plane UseCaseBuilderと同一）

##### スキーマ

Control Plane [UseCaseBuilder Table](#4-usecasebuilder-tablecontrol-plane) と完全に同一のスキーマを使用します。

---

#### 8. PPTX Templates Table（Per-Tenant）

**目的**: PowerPoint生成機能で使用するテンプレートファイルの管理

**実装ファイル**: [`packages/cdk/lib/construct/pptx-db.ts:23`](../../packages/cdk/lib/construct/pptx-db.ts#L23)

**注意**: このテーブルは、PPTX生成機能（`cdk.json`で`PPTX_ENABLED`）が有効な場合のみ作成されます。

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `pptx-templates-<environment>-<tenantId>` |
| **Partition Key** | `templateId` (STRING) |
| **Sort Key** | なし（シンプルキー） |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS_MANAGED（KMS管理キー） |
| **ポイントインタイムリカバリ** | 有効 |
| **TTL属性** | `ttl`（オプション、自動クリーンアップ用） |
| **削除保護** | 有効（本番環境） |

##### Global Secondary Indexes

###### UserIndex
- **Partition Key**: `userId` (STRING)
- **Sort Key**: `createdAt` (STRING)
- **用途**: ユーザーが作成したテンプレート一覧

###### PublicIndex
- **Partition Key**: `isPublic` (STRING) - 値: `"true"` または `"false"`
- **Sort Key**: `createdAt` (STRING)
- **用途**: 公開テンプレートギャラリー

**設計ポイント**: `isPublic` を文字列型にすることで、GSIのパーティションキーとして使用可能。

##### レコード構造

**スキーマ**:
```typescript
{
  templateId: string,                     // PK: ユニークなテンプレートID（UUID）
  userId: string,                         // テンプレート所有者のユーザーID
  createdAt: string,                      // 作成タイムスタンプ（ISO 8601形式）
  updatedAt?: string,                     // 最終更新タイムスタンプ
  templateName: string,                   // テンプレート表示名
  templateDescription?: string,           // テンプレートの説明
  isPublic: "true" | "false",             // 公開可視性（GSIキー）
  s3Key: string,                          // S3に保存されたテンプレートファイルのオブジェクトキー
  thumbnailS3Key?: string,                // サムネイル画像のS3キー
  metadata?: Record<string, any>,         // テンプレートメタデータ（拡張可能）
  ttl?: number                            // 自動削除用のUnixタイムスタンプ（エポック秒）
}
```

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | テンプレート情報取得 | GetItem: `templateId` | テンプレート詳細画面 |
| 2 | ユーザーのテンプレート一覧 | Query UserIndex: `userId`, Sort: `createdAt` DESC | マイテンプレート一覧 |
| 3 | 公開テンプレート一覧 | Query PublicIndex: `isPublic = "true"`, Sort: `createdAt` DESC | テンプレートギャラリー |
| 4 | テンプレート作成 | PutItem | テンプレートアップロード |
| 5 | テンプレート削除 | DeleteItem | テンプレート管理 |

##### S3連携

- **テンプレートファイル**: S3バケットに保存、DynamoDBには`s3Key`のみ保存
- **サムネイル**: プレビュー用のサムネイル画像も同様にS3管理
- **TTL**: 不要なテンプレートは自動削除（ストレージコスト削減）

---

#### 9. PPTX Generations Table（Per-Tenant）

**目的**: PowerPoint生成リクエストの履歴と状態管理

**実装ファイル**: [`packages/cdk/lib/construct/pptx-db.ts:101`](../../packages/cdk/lib/construct/pptx-db.ts#L101)

**注意**: このテーブルは、PPTX生成機能が有効な場合のみ作成されます。

##### テーブル設定

| 項目 | 値 |
|------|-----|
| **Table Name** | `pptx-generations-<environment>-<tenantId>` |
| **Partition Key** | `generationId` (STRING) |
| **Sort Key** | `userId` (STRING) |
| **Billing Mode** | PAY_PER_REQUEST（オンデマンド） |
| **暗号化** | AWS_MANAGED（KMS管理キー） |
| **ポイントインタイムリカバリ** | 有効 |
| **TTL属性** | `ttl`（7日後に自動削除） |
| **削除保護** | 有効（本番環境） |

##### Global Secondary Indexes

###### UserGenerationsIndex
- **Partition Key**: `userId` (STRING)
- **Sort Key**: `createdAt` (STRING)
- **用途**: ユーザーの生成履歴一覧

###### ChatGenerationsIndex
- **Partition Key**: `chatId` (STRING)
- **Sort Key**: `createdAt` (STRING)
- **用途**: 特定チャットで生成されたPPTX一覧

##### レコード構造

**スキーマ**:
```typescript
{
  generationId: string,                   // PK: ユニークな生成ID（UUID）
  userId: string,                         // SK: 生成リクエストを作成したユーザーID
  chatId?: string,                        // 関連するチャットID（オプション）
  templateId?: string,                    // 使用したテンプレートID（オプション）
  createdAt: string,                      // 生成リクエスト作成タイムスタンプ（ISO 8601形式）
  status: "pending" | "processing" | "completed" | "failed",  // 生成ステータス
  s3Key?: string,                         // 生成されたPPTXファイルのS3キー（完了時のみ）
  inputData?: Record<string, any>,        // 生成入力パラメータ（プロンプト、変数など）
  errorMessage?: string,                  // エラー詳細（失敗時のみ）
  ttl?: number                            // 自動削除用のUnixタイムスタンプ（デフォルト: 7日後）
}
```

##### ステータス遷移

```
pending → processing → completed
                    ↘ failed
```

- **pending**: 生成リクエストが作成され、処理待ち
- **processing**: Lambda/Step Functionsで生成処理中
- **completed**: PPTX生成完了、S3にアップロード済み
- **failed**: 生成失敗、エラーメッセージを記録

##### アクセスパターン

| # | パターン | DynamoDB操作 | 使用例 |
|---|----------|--------------|--------|
| 1 | 生成情報取得 | GetItem: `{generationId, userId}` | 生成ステータス確認 |
| 2 | ユーザーの生成履歴 | Query UserGenerationsIndex: `userId`, Sort: `createdAt` DESC | マイ生成履歴 |
| 3 | チャットの生成一覧 | Query ChatGenerationsIndex: `chatId`, Sort: `createdAt` DESC | チャット内PPTX一覧 |
| 4 | ステータス更新 | UpdateItem: `status` | 非同期処理の進捗更新 |

##### TTL自動削除

- **デフォルトTTL**: 7日間（604,800秒）
- **削除対象**: 生成レコード + S3上のPPTXファイル（Lambdaトリガーで連動削除）
- **目的**: ストレージコスト削減、一時ファイルの自動クリーンアップ

---

## テナントコンテキスト抽出パターン

GenUの**最も重要なアーキテクチャパターン**の1つが、テナントコンテキスト抽出です。すべてのLambda関数がこのパターンを使用して、アクセスするテーブルを動的に決定します。

### 実装ファイル

**ファイル**: [`packages/cdk/lambda/repository/common.ts:79`](../../packages/cdk/lambda/repository/common.ts#L79)

### 主要関数

#### 1. `getTenantDynamoDBDocument()`

**シグネチャ**:
```typescript
export async function getTenantDynamoDBDocument(
  event: APIGatewayProxyEvent
): Promise<DynamoDBDocumentClient>
```

**機能**:
1. API Gateway Eventから**Cognito JWTクレーム**を抽出
2. テナントID（`custom:tenantId`）があれば、テナント専用のテーブル名を構築
3. テナントIDがなければ、Control Planeのテーブル名を使用
4. 適切なテーブル名に対してスコープされた**DynamoDBDocumentClient**を返す

**コード例**:
```typescript
// Lambda関数内での使用例
export const handler = async (event: APIGatewayProxyEvent) => {
  // テナントコンテキストを自動抽出
  const dynamodb = await getTenantDynamoDBDocument(event);

  // この時点で、dynamodbはテナント専用テーブルにスコープされている
  // 開発者はテナントIDを意識する必要がない
  const result = await dynamodb.send(new QueryCommand({
    TableName: getTableName(event),  // 自動的にテナントテーブル名を取得
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": `user#${userId}`
    }
  }));
};
```

#### 2. `getTableName()`

**シグネチャ**:
```typescript
export function getTableName(event: APIGatewayProxyEvent): string
```

**機能**:
- イベントからテナントコンテキストを抽出
- テナント専用のChatHistory/Messageテーブル名を返す
- フォーマット: `<TablePrefix>-<environment>-tenant-<tenantId>`

#### 3. `getStatsTableName()`

**シグネチャ**:
```typescript
export function getStatsTableName(event: APIGatewayProxyEvent): string
```

**機能**:
- イベントからテナントコンテキストを抽出
- テナント専用の統計テーブル名を返す
- フォーマット: `<StatsTablePrefix>-<environment>-tenant-<tenantId>`

### テーブル命名規則

#### Control Plane（デフォルト）
```
<TablePrefix>                           例: ChatHistoryDev123ABC
<StatsTablePrefix>                      例: TokenUsageStatsDev456DEF
```

#### Per-Tenant（マルチテナント）
```
<TablePrefix>-<env>-tenant-<tenantId>        例: ChatHistoryDev123ABC-dev-tenant-acme
<StatsTablePrefix>-<env>-tenant-<tenantId>   例: TokenUsageStatsDev456DEF-dev-tenant-acme
```

### Cognito JWT クレームの構造

**マルチテナント環境のJWTクレーム例**:
```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cognito:username": "user@example.com",
  "custom:tenantId": "acme",
  "email": "user@example.com",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/...",
  "exp": 1234567890
}
```

**シングルテナント環境のJWTクレーム例**:
```json
{
  "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cognito:username": "user@example.com",
  "email": "user@example.com",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/...",
  "exp": 1234567890
  // custom:tenantId が存在しない → Control Planeテーブルを使用
}
```

### データ分離の保証

このパターンにより、以下が保証されます：

1. **自動テナント分離**: 開発者が明示的にテナントIDをフィルタする必要がない
2. **認証ベース**: JWTクレームが改ざんされていないことをCognitoが保証
3. **IAMポリシー**: Lambda実行ロールのIAMポリシーでテーブルアクセスをさらに制限
4. **フォールバック**: テナントIDがない場合は自動的にControl Planeにフォールバック

---

## データ分離戦略

GenUは**多層防御**によるデータ分離を実装しています。

### 1. IAMベース分離

**メカニズム**:
- 各Lambda関数は**テナント固有のIAMロール**を持つ
- IAMポリシーで、特定テナントのテーブルのみアクセス可能に制限

**IAMポリシー例**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Query",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:123456789012:table/ChatHistory-dev-tenant-${aws:PrincipalTag/TenantId}",
        "arn:aws:dynamodb:us-east-1:123456789012:table/TokenUsageStats-dev-tenant-${aws:PrincipalTag/TenantId}"
      ]
    }
  ]
}
```

**セッションタグ**: Cognito JWTクレームからテナントIDを抽出し、IAMセッションタグとして設定することで、動的なリソースアクセス制御を実現。

### 2. テーブルレベル分離

**メカニズム**:
- 各テナントは**完全に独立したDynamoDBテーブル**を持つ
- テーブル名にテナントIDが含まれる

**メリット**:
- **物理的分離**: データが混在する可能性がゼロ
- **パフォーマンス分離**: 大量データを持つテナントが他のテナントに影響しない
- **コスト可視化**: CloudWatchメトリクスでテナントごとのコストを追跡可能
- **削除の容易性**: テナント解約時にテーブルを削除するだけで完全にデータ削除
- **バックアップ/リストア**: テナント単位でバックアップ・リストア可能

### 3. 自動ルーティング

**メカニズム**:
- `getTenantDynamoDBDocument()` が自動的に適切なテーブルを選択
- アプリケーションコードはテナントIDを意識不要

**コード例**:
```typescript
// 開発者が書くコード（テナントを意識しない）
const dynamodb = await getTenantDynamoDBDocument(event);
const result = await dynamodb.send(new QueryCommand({
  TableName: getTableName(event),
  // ...
}));

// 実際にアクセスされるテーブル名（自動決定）
// テナントA → ChatHistory-dev-tenant-tenantA
// テナントB → ChatHistory-dev-tenant-tenantB
// デフォルト → ChatHistoryDev123ABC
```

### 4. デフォルトへのフォールバック

**メカニズム**:
- テナントコンテキストが存在しない場合（`custom:tenantId`クレームなし）
- 自動的にControl Planeテーブルにフォールバック
- シングルテナント環境との互換性を保証

**使用ケース**:
- シングルテナントデプロイメント
- 管理者ユーザー（全テナント横断操作）
- システム内部処理

---

## 主要機能

### TTL（Time-to-Live）

**概要**: DynamoDBの自動削除機能により、一定期間経過したデータを自動的に削除。

#### 有効なテーブル

| テーブル | TTL期間 | 用途 |
|---------|---------|------|
| PPTX Templates | カスタム（オプション） | 一時テンプレートの自動削除 |
| PPTX Generations | 7日間（固定） | 生成ファイルの自動クリーンアップ |

#### 実装詳細

**PPTX Generations のTTL設定**:
```typescript
// レコード作成時にTTLを設定
const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7日後
await dynamodb.send(new PutItemCommand({
  TableName: "pptx-generations-dev-tenant-acme",
  Item: {
    generationId: "gen-123",
    userId: "user-456",
    ttl: ttl,  // ← TTL属性
    // ...
  }
}));
```

**メリット**:
- **自動クリーンアップ**: 手動削除処理が不要
- **コスト削減**: 不要なデータのストレージコスト削減
- **運用負荷軽減**: 定期削除バッチジョブが不要

---

### ポイントインタイムリカバリ（PITR）

**概要**: DynamoDBテーブルのバックアップ機能により、過去35日以内の任意の時点にリストア可能。

#### 有効なテーブル

| テーブル | PITR | 理由 |
|---------|------|------|
| PPTX Templates | ✅ 有効 | 誤削除からの復旧が重要 |
| PPTX Generations | ✅ 有効 | 生成履歴の保護 |
| Tenants | ✅ 有効 | テナント情報は極めて重要 |
| その他のテーブル | ❌ 無効 | コスト最適化（必要に応じて有効化可能） |

**コスト考慮**:
- PITRはストレージサイズに応じた追加料金が発生
- 重要なテーブルのみ有効化することでコスト最適化

---

### 暗号化

**概要**: すべてのDynamoDBテーブルは保存時暗号化（Encryption at Rest）を使用。

#### 暗号化タイプ

| 暗号化タイプ | 使用テーブル | メリット | コスト |
|-------------|-------------|---------|--------|
| **AWS所有キー**（デフォルト） | Control Plane テーブル、Tenantテーブル | 追加コストなし、自動管理 | 無料 |
| **AWS管理キー** | PPTXテーブル、Tenantsテーブル | CloudTrailでキー使用を監査可能 | 月額$1/キー + API呼び出し料金 |
| **カスタマー管理キー** | なし（オプション） | 完全なキー制御、キーローテーション | 月額$1/キー + 管理オーバーヘッド |

**選択基準**:
- **デフォルト（AWS所有キー）**: ほとんどのケースで十分
- **AWS管理キー**: コンプライアンス要件がある場合（PPTX機能など）
- **カスタマー管理キー**: 規制要件が厳しい業界（金融、医療など）

---

### 削除保護

**概要**: 誤ってテーブルを削除することを防ぐ保護機能。

#### 有効なテーブル

| テーブル | 削除保護（本番） | 削除保護（開発） |
|---------|----------------|-----------------|
| PPTX Templates | ✅ 有効 | ❌ 無効 |
| PPTX Generations | ✅ 有効 | ❌ 無効 |
| その他のテーブル | 環境依存 | ❌ 無効 |

**CDK実装例**:
```typescript
const table = new dynamodb.Table(this, "PptxTemplates", {
  // ...
  removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  deletionProtection: isProd, // 本番環境のみ有効
});
```

**運用ポリシー**:
- **本番環境**: 削除保護を有効化し、誤削除を防止
- **開発環境**: 削除保護を無効化し、迅速な環境削除を可能に

---

## サマリー統計

### テーブル総数

| カテゴリ | 数 | 詳細 |
|---------|---|------|
| **Control Planeテーブル** | 4 | Main, Stats, Tenants, UseCaseBuilder |
| **Core Per-Tenantテーブル** | 3 | ChatHistory, TokenUsageStats, UseCaseBuilder（テナント版） |
| **Optional Per-Tenantテーブル** | 2 | PPTX Templates, PPTX Generations（PPTX機能有効時） |
| **合計** | **9種類** | 異なるスキーマを持つテーブルタイプ |

### Global Secondary Indexes（GSI）総数

| GSI名 | テーブル | 個数 |
|-------|---------|------|
| FeedbackIndex | Main, Tenant ChatHistory | 2個 |
| MonthIndex | Tenant TokenUsageStats | 1個 |
| UseCaseIdIndexName | UseCaseBuilder（Control + Tenant） | 2個 |
| UserIndex | PPTX Templates | 1個 |
| PublicIndex | PPTX Templates | 1個 |
| UserGenerationsIndex | PPTX Generations | 1個 |
| ChatGenerationsIndex | PPTX Generations | 1個 |
| **合計** | | **10個** |

### 主要リポジトリファイル

**データアクセス層**（Repository Pattern）:

| ファイル | 役割 | 行数（概算） |
|---------|------|------------|
| [`common.ts`](../../packages/cdk/lambda/repository/common.ts) | **テナントコンテキスト抽出**、共通ユーティリティ | ~150行 |
| [`chat.ts`](../../packages/cdk/lambda/repository/chat.ts) | チャット作成、取得、更新、削除 | ~200行 |
| [`message.ts`](../../packages/cdk/lambda/repository/message.ts) | メッセージ保存、トークン追跡 | ~250行 |
| [`stats.ts`](../../packages/cdk/lambda/repository/stats.ts) | 統計集計、アトミック更新 | ~180行 |
| [`share.ts`](../../packages/cdk/lambda/repository/share.ts) | チャット共有、双方向マッピング | ~120行 |
| [`systemContext.ts`](../../packages/cdk/lambda/repository/systemContext.ts) | システムコンテキスト管理 | ~100行 |

**インフラストラクチャ定義**（AWS CDK）:

| ファイル | 役割 |
|---------|------|
| [`database.ts`](../../packages/cdk/lib/construct/database.ts) | Control Planeテーブル定義 |
| [`tenant-dynamodb.ts`](../../packages/cdk/lib/construct/tenant-dynamodb.ts) | Per-Tenantテーブル定義 |
| [`tenant-manager.ts`](../../packages/cdk/lib/construct/tenant-manager.ts) | Tenantsテーブル、テナント管理API |
| [`use-case-builder.ts`](../../packages/cdk/lib/construct/use-case-builder.ts) | UseCaseBuilderテーブル定義 |
| [`pptx-db.ts`](../../packages/cdk/lib/construct/pptx-db.ts) | PPTXテーブル定義 |

---

## 参考リンク

- **プロジェクト構造**: [`CLAUDE.md`](../../CLAUDE.md) - 全体アーキテクチャ
- **デプロイオプション**: [`docs/ja/DEPLOY_OPTION.md`](./DEPLOY_OPTION.md) - マルチテナント設定
- **開発ガイド**: [`docs/ja/DEVELOPMENT.md`](./DEVELOPMENT.md) - ローカル開発環境
- **AWS DynamoDB公式ドキュメント**: https://docs.aws.amazon.com/dynamodb/

---

## 変更履歴

| 日付 | 変更内容 | 著者 |
|------|---------|------|
| 2025-10-30 | 初版作成 | Claude Code |

---

**Note**: このドキュメントは、コードベースの調査結果を基に自動生成されました。スキーマやアクセスパターンが変更された場合は、このドキュメントも更新してください。
