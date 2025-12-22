# v0.5.3 BotTableV3 および S3バケット仕様

本ドキュメントは、v0.5.3からdevelopブランチへの移行に必要なデータ構造の調査結果をまとめたものです。

## 1. BotTableV3 テーブル仕様

### 1.1 テーブル基本情報

| 項目 | 値 |
|------|-----|
| テーブル名 | `{スタック名}-Database-BotTableV3-XXXXXXX` |
| Billing Mode | PAY_PER_REQUEST (オンデマンド) |
| Stream | NEW_IMAGE (有効) |
| PITR | 有効 |
| 暗号化 | AWS_MANAGED |

### 1.2 キー構造

| キー | 属性名 | 型 | 内容 |
|------|--------|-----|------|
| Partition Key (PK) | `PK` | String | UserId (ボット所有者のユーザーID) |
| Sort Key (SK) | `SK` | String | `BOT#{bot_id}` または `ALIAS#{bot_id}` |

### 1.3 インデックス

#### ローカルセカンダリインデックス (LSI)

| インデックス名 | Sort Key | 用途 |
|---------------|----------|------|
| `StarredIndex` | `IsStarred` (String) | スター付きボットの取得 |
| `LastUsedTimeIndex` | `LastUsedTime` (Number) | 最近使用したボットの取得 |

#### グローバルセカンダリインデックス (GSI)

| インデックス名 | Partition Key | Sort Key | 用途 |
|---------------|---------------|----------|------|
| `BotIdIndex` | `BotId` (String) | - | BotIdでのボット検索 |
| `SharedScopeIndex` | `SharedScope` (String) | `SharedStatus` (String) | 共有ボットの検索 |
| `ItemTypeIndex` | `ItemType` (String) | - | ユーザー所有ボット/エイリアスの取得 |

### 1.4 主要属性

#### ボットアイテム (ItemType = `{user_id}#BOT`)

| 属性名 | 型 | 説明 |
|--------|-----|------|
| `PK` | String | ユーザーID |
| `SK` | String | `BOT#{bot_id}` |
| `ItemType` | String | `{user_id}#BOT` |
| `BotId` | String | ボットの一意識別子 |
| `Title` | String | ボットのタイトル |
| `Description` | String | ボットの説明 |
| `Instruction` | String | ボットへの指示（システムプロンプト） |
| `CreateTime` | Number | 作成日時（UNIXタイムスタンプ） |
| `LastUsedTime` | Number | 最終使用日時（オプション、スパースインデックス用） |
| `SharedScope` | String | 共有範囲: `private`, `partial`, `all`（`private`時は属性なし） |
| `SharedStatus` | String | 共有ステータス: `unshared`, `shared`, `pinned@XXX` |
| `AllowedCognitoGroups` | List | アクセス許可されたCognitoグループ |
| `AllowedCognitoUsers` | List | アクセス許可されたCognitoユーザー |
| `IsStarred` | String | スター付き時は`"TRUE"`（オプション、スパースインデックス用） |
| `Knowledge` | Map | ナレッジ設定（下記参照） |
| `AgentData` | Map | エージェント設定（ツール一覧） |
| `GenerationParams` | Map | 生成パラメータ |
| `PromptCachingEnabled` | Boolean | プロンプトキャッシュの有効/無効 |
| `SyncStatus` | String | 同期ステータス: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED` |
| `SyncStatusReason` | String | 同期ステータスの理由 |
| `LastExecId` | String | 最終実行ID |
| `BedrockKnowledgeBase` | Map | Bedrock Knowledge Base設定（オプション） |
| `GuardrailsParams` | Map | Guardrails設定（オプション） |
| `DisplayRetrievedChunks` | Boolean | 取得チャンクの表示設定 |
| `ConversationQuickStarters` | List | クイックスターター設定 |
| `ActiveModels` | Map | 有効なモデルの設定 |
| `UsageStats` | Map | 使用統計（usage_count） |
| `ApiPublishmentStackName` | String | API公開スタック名（オプション） |
| `ApiPublishedDatetime` | Number | API公開日時（オプション） |
| `ApiPublishCodeBuildId` | String | API公開CodeBuild ID（オプション） |

#### Knowledge属性の構造

```json
{
  "source_urls": ["https://example.com/docs"],
  "sitemap_urls": ["https://example.com/sitemap.xml"],
  "filenames": ["document1.pdf", "document2.txt"],
  "s3_urls": ["s3://bucket-name/path/to/file.pdf"]
}
```

| フィールド | 説明 |
|-----------|------|
| `source_urls` | クロール対象のウェブサイトURL |
| `sitemap_urls` | サイトマップURL |
| `filenames` | アップロードされたファイル名（S3に格納済み） |
| `s3_urls` | 外部S3 URLのリスト |

#### BedrockKnowledgeBase属性の構造

```json
{
  "embeddings_model": "cohere.embed-multilingual-v3",
  "open_search": {
    "analyzer": {
      "character_filters": ["icu_normalizer"],
      "tokenizer": "kuromoji_tokenizer",
      "token_filters": ["kuromoji_baseform", "kuromoji_part_of_speech"]
    }
  },
  "chunking_configuration": {
    "chunking_strategy": "fixed_size",
    "max_tokens": 300,
    "overlap_percentage": 20
  },
  "search_params": {
    "max_results": 20,
    "search_type": "hybrid"
  },
  "knowledge_base_id": "XXXXXXXXXX",
  "data_source_ids": ["YYYYYYYYYY"],
  "parsing_model": "disabled",
  "web_crawling_scope": "DEFAULT",
  "web_crawling_filters": {
    "exclude_patterns": [],
    "include_patterns": []
  }
}
```

#### エイリアスアイテム (ItemType = `{user_id}#ALIAS`)

| 属性名 | 型 | 説明 |
|--------|-----|------|
| `PK` | String | エイリアスを持つユーザーID |
| `SK` | String | `ALIAS#{original_bot_id}` |
| `ItemType` | String | `{user_id}#ALIAS` |
| `OriginalBotId` | String | 元のボットID |
| `OwnerUserId` | String | 元ボットの所有者ユーザーID |
| `Title` | String | ボットタイトル |
| `Description` | String | ボット説明 |
| `IsOriginAccessible` | Boolean | 元ボットへのアクセス可否 |
| `CreateTime` | Number | エイリアス作成日時 |
| `LastUsedTime` | Number | 最終使用日時 |
| `IsStarred` | String | スター付き時は`"TRUE"` |
| `SyncStatus` | String | 同期ステータス |
| `HasKnowledge` | Boolean | ナレッジの有無 |
| `HasAgent` | Boolean | エージェントの有無 |
| `ConversationQuickStarters` | List | クイックスターター設定 |
| `ActiveModels` | Map | 有効なモデルの設定 |

---

## 2. S3バケット（RAGデータ）仕様

### 2.1 バケット基本情報

| 項目 | 値 |
|------|-----|
| バケット名 | `bedrock-chat-docs-${environment}-${tenantId}` |
| 暗号化 | S3_MANAGED |
| パブリックアクセス | 完全ブロック |
| SSL強制 | 有効 |
| CORS | GET/PUT/POST を許可 |

### 2.2 ファイル格納パス構造

```
bedrock-chat-docs-${environment}-${tenantId}/
├── {user_id}/
│   └── {bot_id}/
│       ├── documents/
│       │   ├── document1.pdf
│       │   ├── document2.txt
│       │   └── ...
│       └── _temp/
│           └── (アップロード中の一時ファイル)
```

| パス | 説明 |
|------|------|
| `{user_id}/{bot_id}/documents/{filename}` | RAG用の確定済みドキュメント |
| `{user_id}/{bot_id}/_temp/{filename}` | アップロード中の一時ファイル（ボット作成/更新後に削除） |

### 2.3 ファイルアップロードフロー

1. クライアントが `/bot/{bot_id}/presigned-url` APIで署名付きURLを取得
2. クライアントが署名付きURLを使用してS3の `_temp/` ディレクトリにアップロード
3. ボット作成/更新時に `_temp/` から `documents/` へファイルを移動
4. `_temp/` ディレクトリ内のファイルを削除

### 2.4 関連するS3バケット（その他）

| バケット名 | 用途 |
|-----------|------|
| `bedrock-chat-large-msg-${environment}-${tenantId}` | 32KB超の大容量メッセージ保存用 |
| `bedrock-chat-access-logs-${environment}-${tenantId}` | アクセスログ保存用 |
| `bedrock-chat-codebuild-src-${environment}-${tenantId}` | CodeBuildソースコード用 |

---

## 3. バックアップ対象データのまとめ

### 3.1 DynamoDBからの抽出対象

- **テーブル**: BotTableV3
- **抽出条件**: `SK` が `BOT#` で始まるアイテム（エイリアスは含めない）
- **主要フィールド**:
  - `BotId`, `Title`, `Description`, `Instruction`
  - `Knowledge` (filenames, source_urls, sitemap_urls, s3_urls)
  - `BedrockKnowledgeBase` (Knowledge Base設定がある場合)
  - `AgentData` (エージェントツール設定がある場合)
  - `GenerationParams`
  - `ConversationQuickStarters`

### 3.2 S3からの抽出対象

- **バケット**: `bedrock-chat-docs-${environment}-${tenantId}`
- **パス**: `{user_id}/{bot_id}/documents/*`
- **ファイル**: `Knowledge.filenames` に記載されているファイル

### 3.3 注意事項

1. **Knowledge Base ID**: `BedrockKnowledgeBase.knowledge_base_id` は環境固有のリソースIDのため、移行後は再作成が必要
2. **Data Source ID**: `BedrockKnowledgeBase.data_source_ids` も同様に再作成が必要
3. **ユーザーID**: PKに使用されるユーザーIDはCognitoユーザープールに依存するため、同一Cognitoプールを使用しない場合はマッピングが必要
