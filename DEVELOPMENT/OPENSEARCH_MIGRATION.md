# OpenSearch代替案: コスト最適化のための移行ガイド

## 目次

- [概要](#概要)
- [現状分析](#現状分析)
- [改善案の比較](#改善案の比較)
- [推奨案: Typesense on ECS Fargate](#推奨案-typesense-on-ecs-fargate)
- [実装計画](#実装計画)
- [FAQ](#faq)

---

## 概要

本ドキュメントは、GenUプロジェクトにおけるOpenSearchの使用状況を分析し、コスト最適化のための代替案を提案するものです。

### 背景

- OpenSearchは会話検索とボット検索に使用されており、高いコストが課題となっている
- Sort Key以外のフィールドでのソートや複雑な検索が必要
- 月間コスト: $100〜$500程度

### 目標

- OpenSearchのコストを60%以上削減
- 検索機能（プレフィックス検索、ファジー検索）を維持
- 1秒以内のレスポンス時間を保証
- 中規模データ（会話数: 数十万件、ボット数: 数千件）に対応

---

## 現状分析

### OpenSearchの使用箇所

#### 1. 会話検索 (`conversation`インデックス)

**ファイル:** `packages/cdk/lib/temp-bedrock-chat/backend/app/repositories/conversation_search.py`

**機能:**
- 会話タイトルとメッセージ内容での全文検索
- マルチマッチクエリ（タイトル、メッセージ本文）
- フレーズマッチングとファジー検索
- ハイライト機能

**ソート要件:**
```python
"sort": [
    {"_score": {"order": "desc"}},  # 関連度スコア
    {"messages.value.create_time": {
        "order": "desc",
        "mode": "max"  # 最新メッセージ時刻
    }}
]
```

**課題:**
- DynamoDBのSort Keyでは複数フィールドのソートができない
- ネストされたフィールド（`messages.value.create_time`）のソートが必要

#### 2. ボット検索 (`bot`インデックス)

**ファイル:** `packages/cdk/lib/temp-bedrock-chat/backend/app/repositories/bot_store.py`

**機能:**
- ボットのタイトル、説明、指示での全文検索
- 複雑なアクセス制御フィルタ（public/private/partial shared）
- Painlessスクリプトによる動的グループフィルタリング
- 使用回数でのソート

**ソート要件:**
```python
"sort": [{"UsageStats.usage_count": {"order": "desc"}}]
```

**課題:**
- `UsageStats.usage_count`はDynamoDBのSort Keyではない
- アクセス制御ロジックが複雑（Painlessスクリプト使用）

#### 3. 使用状況分析

**ファイル:** `packages/cdk/lib/temp-bedrock-chat/backend/app/repositories/usage_analysis.py`

**機能:**
- ボットと使用料金での集計
- Athenaクエリによる分析

**OpenSearch使用:** なし（Athena使用）

### インフラストラクチャ

**ファイル:** `packages/cdk/lib/stacks/tenant/tenant-opensearch-stack.ts`

**構成:**
- OpenSearch 2.19
- VPC内にデプロイ
- テナントごとに独立したドメイン
- セキュリティグループによるアクセス制御
- Bedrock Knowledge Baseとの統合

**推定コスト（テナントあたり）:**
- インスタンスタイプ: `t3.small.search` (2データノード)
- EBS: 20GB × 2
- 月間コスト: $100〜$300
- マルチテナント環境では総コスト: $500〜$1500/月

---

## 改善案の比較

### 案1: Typesense on ECS Fargate ⭐️ **推奨**

| 項目 | 評価 | 詳細 |
|------|------|------|
| **コスト** | ⭐️⭐️⭐️⭐️⭐️ | $35〜$50/月（60〜90%削減） |
| **機能** | ⭐️⭐️⭐️⭐️ | 全文検索、ファジー検索、ソート対応 |
| **パフォーマンス** | ⭐️⭐️⭐️⭐️⭐️ | 1秒以内のレスポンス保証 |
| **移行コスト** | ⭐️⭐️⭐️⭐️ | 検索層のみ置き換え |
| **運用負荷** | ⭐️⭐️⭐️ | DynamoDB Streamsの管理が必要 |

**メリット:**
- 大幅なコスト削減
- OpenSearchと同等の検索機能
- 高速なレスポンス
- シンプルなREST API
- DynamoDBとの並行運用が可能

**デメリット:**
- データ同期の実装が必要
- Painlessスクリプトは使えない（アプリ側で実装）

### 案2: Aurora PostgreSQL with full-text search

| 項目 | 評価 | 詳細 |
|------|------|------|
| **コスト** | ⭐️⭐️⭐️ | $50〜$150/月（50〜70%削減） |
| **機能** | ⭐️⭐️⭐️⭐️⭐️ | SQLで柔軟なクエリが可能 |
| **パフォーマンス** | ⭐️⭐️⭐️ | データ量次第で遅延の可能性 |
| **移行コスト** | ⭐️ | DynamoDBからRDBへの大規模移行 |
| **運用負荷** | ⭐️⭐️⭐️⭐️ | マネージドサービス |

**メリット:**
- トランザクション対応
- 複雑なJOINクエリが可能
- マネージドサービスで運用が楽

**デメリット:**
- 大規模な移行作業が必要
- アプリケーション全体の書き換え
- スケーラビリティがDynamoDBより低い

### 案3: DynamoDB GSI最適化 + アプリケーション側ソート

| 項目 | 評価 | 詳細 |
|------|------|------|
| **コスト** | ⭐️⭐️⭐️⭐️⭐️ | $0（追加コストなし） |
| **機能** | ⭐️⭐️ | プレフィックス検索のみ |
| **パフォーマンス** | ⭐️⭐️ | 大量データで遅延の可能性 |
| **移行コスト** | ⭐️⭐️⭐️⭐️⭐️ | 最小限の変更 |
| **運用負荷** | ⭐️⭐️⭐️⭐️⭐️ | インフラがシンプル |

**メリット:**
- 追加コストゼロ
- インフラがシンプル
- DynamoDB単一でデータ管理

**デメリット:**
- 全文検索は不可
- メモリ消費が増加
- レイテンシーが1秒を超える可能性

### 案4: Amazon OpenSearch Serverless

| 項目 | 評価 | 詳細 |
|------|------|------|
| **コスト** | ⭐️ | $700/月〜（コスト増加） |
| **機能** | ⭐️⭐️⭐️⭐️⭐️ | OpenSearchの全機能 |
| **パフォーマンス** | ⭐️⭐️⭐️⭐️⭐️ | スケーラブル |
| **移行コスト** | ⭐️⭐️⭐️⭐️ | マネージドOpenSearchへの移行 |
| **運用負荷** | ⭐️⭐️⭐️⭐️⭐️ | フルマネージド |

**結論:** コスト削減にならないため非推奨

---

## 推奨案: Typesense on ECS Fargate

### アーキテクチャ概要

```
┌─────────────────┐
│   Frontend      │
│   (React)       │
└────────┬────────┘
         │ API Gateway
         ▼
┌─────────────────────────────────────────┐
│          Lambda Functions               │
│  ┌──────────────┐  ┌────────────────┐  │
│  │ Chat API     │  │ Bot Store API  │  │
│  └──────┬───────┘  └────────┬───────┘  │
│         │                   │           │
└─────────┼───────────────────┼───────────┘
          │                   │
    ┌─────▼─────┐       ┌────▼────┐
    │ DynamoDB  │       │Typesense│
    │  (Main)   │       │on Fargate│
    │           │       │         │
    └─────┬─────┘       └────▲────┘
          │                  │
          │  DynamoDB        │
          │  Streams         │
          └──────────►Lambda─┘
                     (Sync)
```

### コンポーネント詳細

#### 1. Typesense on ECS Fargate

**CDK構成:**
```typescript
// packages/cdk/lib/construct/typesense-cluster.ts

const typesenseCluster = new ecs.Cluster(this, 'TypesenseCluster', {
  vpc: props.vpc,
  enableFargateCapacityProviders: true,
});

const taskDefinition = new ecs.FargateTaskDefinition(this, 'TypesenseTask', {
  memoryLimitMiB: 1024,    // 1GB
  cpu: 512,                 // 0.5 vCPU
});

taskDefinition.addContainer('typesense', {
  image: ecs.ContainerImage.fromRegistry('typesense/typesense:27.1'),
  environment: {
    TYPESENSE_DATA_DIR: '/data',
    TYPESENSE_ENABLE_CORS: 'true',
  },
  secrets: {
    TYPESENSE_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
  },
  portMappings: [{
    containerPort: 8108,
    protocol: ecs.Protocol.TCP,
  }],
  logging: ecs.LogDriver.awsLogs({
    streamPrefix: 'typesense',
  }),
});
```

#### 2. DynamoDB Streams同期

**Lambda関数構成:**
```typescript
const syncFunction = new NodejsFunction(this, 'TypesenseSync', {
  runtime: LAMBDA_RUNTIME_NODEJS,
  entry: './lambda/syncToTypesense.ts',
  timeout: Duration.minutes(1),
  environment: {
    TYPESENSE_HOST: typesenseService.loadBalancer.loadBalancerDnsName,
    TYPESENSE_API_KEY_SECRET_ARN: apiKeySecret.secretArn,
  },
  vpc: props.vpc,
});

// DynamoDB Streamsをイベントソースとして設定
syncFunction.addEventSource(new DynamoEventSource(conversationTable, {
  startingPosition: StartingPosition.LATEST,
  batchSize: 10,
  retryAttempts: 3,
}));
```

### コスト試算

#### Typesense構成（テナントあたり）

| リソース | スペック | 月間コスト |
|----------|----------|-----------|
| ECS Fargate | 0.5 vCPU, 1GB RAM | $30 |
| Application Load Balancer | 標準 | $20 |
| EFS (データ永続化) | 5GB | $2 |
| データ転送 | 10GB/月 | $1 |
| Lambda (同期) | 100万リクエスト/月 | $2 |
| **合計** | | **$55/月** |

#### マルチテナント構成

1テナントあたりの追加コスト: $0（共有インフラ）
テナント数に応じたスケーリング: Fargate Spotでさらに削減可能

**削減額:**
- OpenSearch: $100〜$300/月/テナント
- Typesense: $55/月（全テナント共有可能）
- **削減率: 70〜90%**

### 機能比較

| 機能 | OpenSearch | Typesense | 実装難易度 |
|------|-----------|-----------|-----------|
| 全文検索 | ✅ | ✅ | 簡単 |
| ファジー検索 | ✅ | ✅ | 簡単 |
| 複数フィールドソート | ✅ | ✅ | 簡単 |
| ハイライト | ✅ | ✅ | 簡単 |
| ネストフィールド検索 | ✅ | ✅ | 中程度 |
| Painlessスクリプト | ✅ | ❌ | 中程度（アプリ側実装） |
| 集計（Aggregation） | ✅ | ✅ | 簡単 |
| 地理空間検索 | ✅ | ✅ | 簡単 |

### 検索クエリの変換例

#### OpenSearch（会話検索）

```python
search_body = {
    "query": {
        "bool": {
            "should": [
                {"match": {"Title": {"query": query, "boost": 3.0}}},
                {"match": {"messages.value.content.body": {"query": query}}}
            ],
            "filter": {"bool": {"must": [
                {"term": {"PK.keyword": user.id}}
            ]}}
        }
    },
    "sort": [
        {"_score": {"order": "desc"}},
        {"messages.value.create_time": {"order": "desc", "mode": "max"}}
    ]
}
```

#### Typesense（会話検索）

```typescript
const searchParams = {
  q: query,
  query_by: 'title,message_content',
  filter_by: `user_id:=${userId}`,
  sort_by: '_text_match:desc,last_message_time:desc',
  per_page: 20,
  highlight_fields: 'title,message_content',
  highlight_full_fields: 'message_content',
};

const response = await client
  .collections('conversations')
  .documents()
  .search(searchParams);
```

**変換のポイント:**
- `query_by`: 検索対象フィールドをカンマ区切りで指定
- `filter_by`: SQLライクなフィルタ構文
- `sort_by`: 複数ソートフィールドをカンマ区切り
- ネストフィールドは事前にフラット化

### データスキーマ設計

#### 会話検索スキーマ

```typescript
const conversationSchema = {
  name: 'conversations',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'user_id', type: 'string', facet: true },
    { name: 'title', type: 'string' },
    { name: 'message_content', type: 'string[]' },  // メッセージ本文の配列
    { name: 'last_message_time', type: 'int64', sort: true },
    { name: 'create_time', type: 'int64' },
    { name: 'bot_id', type: 'string', optional: true, facet: true },
  ],
  default_sorting_field: 'last_message_time',
};
```

#### ボット検索スキーマ

```typescript
const botSchema = {
  name: 'bots',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'owner_id', type: 'string', facet: true },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'instruction', type: 'string' },
    { name: 'usage_count', type: 'int32', sort: true },
    { name: 'shared_scope', type: 'string', facet: true },  // 'private', 'partial', 'all'
    { name: 'allowed_users', type: 'string[]', optional: true, facet: true },
    { name: 'allowed_groups', type: 'string[]', optional: true, facet: true },
    { name: 'create_time', type: 'int64' },
    { name: 'last_used_time', type: 'int64', sort: true },
  ],
  default_sorting_field: 'usage_count',
};
```

### セキュリティ考慮事項

#### ネットワークセキュリティ

- Typesenseは**VPC内のプライベートサブネット**にデプロイ
- Application Load Balancerは**内部ALB**を使用
- Lambda関数は**VPC内**から接続
- Security Groupで**Lambda → Typesense**のみ許可

#### 認証・認可

- Typesense API KeyはSecrets Managerで管理
- ユーザー認証はCognito（既存）
- データフィルタリングはLambda関数で実施（`filter_by`に`user_id`を設定）

#### データ暗号化

- EFS暗号化（at rest）
- TLS 1.2以上（in transit）
- Secrets Manager自動ローテーション

---

## 実装計画

### フェーズ1: 基盤構築（2週間）

#### Week 1: インフラ構築

**タスク:**
1. Typesense CDK constructの作成
   - ECS Fargateクラスター
   - Application Load Balancer（内部）
   - EFS（データ永続化）
   - Secrets Manager（API Key）

2. ネットワーク設定
   - Security Group設定
   - VPCエンドポイント設定

3. モニタリング設定
   - CloudWatch Logsの設定
   - CloudWatch Alarmsの設定
   - X-Rayトレーシング

**成果物:**
- `packages/cdk/lib/construct/typesense-cluster.ts`
- `packages/cdk/lib/stacks/common/typesense-stack.ts`

#### Week 2: データ同期基盤

**タスク:**
1. DynamoDB Streams Lambda関数の作成
   - INSERT/MODIFY/REMOVEイベントのハンドリング
   - Typesense APIクライアントの実装
   - エラーハンドリングとリトライ

2. 初期データ移行スクリプト
   - DynamoDB全件スキャン
   - Typesenseへのバルクインポート

3. データ整合性チェック
   - 同期ステータスの監視
   - データ不整合の検知

**成果物:**
- `packages/cdk/lambda/syncToTypesense.ts`
- `packages/cdk/lambda/initialDataMigration.ts`

### フェーズ2: 検索機能実装（2週間）

#### Week 3: 検索APIの実装

**タスク:**
1. 会話検索APIの実装
   - OpenSearch → Typesense変換
   - ハイライト機能の実装
   - ページネーション

2. ボット検索APIの実装
   - アクセス制御ロジックの実装
   - 使用回数ソート
   - フィルタリング機能

3. ユニットテストの作成

**成果物:**
- `packages/cdk/lambda/searchConversationsTypesense.ts`
- `packages/cdk/lambda/searchBotsTypesense.ts`

#### Week 4: フロントエンド統合

**タスク:**
1. 検索APIフックの更新
   - `useConversationSearch`の修正
   - `useBotSearch`の修正

2. UIコンポーネントの調整
   - ハイライト表示の調整
   - エラーハンドリング

3. E2Eテストの作成

**成果物:**
- `packages/web/src/hooks/useConversationSearchTypesense.ts`
- `packages/web/src/hooks/useBotSearchTypesense.ts`

### フェーズ3: 移行とカットオーバー（1週間）

#### Week 5: 段階的移行

**タスク:**
1. フィーチャーフラグの実装
   - `USE_TYPESENSE`環境変数
   - OpenSearchとTypesenseの並行運用

2. 本番環境へのデプロイ
   - カナリアデプロイメント
   - パフォーマンス監視

3. データ整合性の検証
   - 検索結果の比較
   - レイテンシーの測定

4. OpenSearchの削除
   - データのバックアップ
   - リソースの削除

**成果物:**
- デプロイメント手順書
- ロールバック手順書

### フェーズ4: 最適化と運用移行（1週間）

#### Week 6: パフォーマンス最適化

**タスク:**
1. クエリの最適化
   - インデックス設定の調整
   - キャッシュ戦略の実装

2. コストの最適化
   - Fargate Spotの活用
   - リソースの最適化

3. 運用ドキュメントの作成
   - トラブルシューティングガイド
   - 監視ダッシュボードの作成

**成果物:**
- 運用ドキュメント
- CloudWatch Dashboard

### マイルストーン

| マイルストーン | 期限 | 成果物 |
|--------------|------|--------|
| M1: インフラ構築完了 | Week 2 | Typesenseクラスター稼働 |
| M2: データ同期確立 | Week 2 | 自動同期が稼働 |
| M3: 検索API実装完了 | Week 4 | 全検索機能が動作 |
| M4: カットオーバー完了 | Week 5 | OpenSearch削除 |
| M5: 運用移行完了 | Week 6 | 運用体制確立 |

### リスクと対策

| リスク | 影響度 | 対策 |
|--------|--------|------|
| データ同期の遅延 | 高 | DLQの設定、リトライ機能 |
| 検索精度の低下 | 中 | A/Bテスト、段階的移行 |
| パフォーマンス低下 | 中 | キャッシュ戦略、インデックス最適化 |
| 移行中の障害 | 高 | ロールバック手順、並行運用 |
| コストオーバー | 低 | コスト監視、リソース最適化 |

---

## FAQ

### Q1: Typesenseの可用性はどのように確保しますか？

**A:** 以下の方法で高可用性を確保します：
- ECS Fargateでマルチアベイラビリティゾーン構成
- Application Load Balancerでヘルスチェック
- EFSでデータの永続化
- 自動フェイルオーバー機能

### Q2: データの整合性はどのように保証しますか？

**A:** 以下の仕組みで整合性を保証します：
- DynamoDB StreamsでEventual Consistency
- Lambda関数のリトライ機能
- DLQ（Dead Letter Queue）での失敗イベント管理
- 定期的な整合性チェックバッチ

### Q3: OpenSearchと比較して機能的な制約はありますか？

**A:** 主な制約は以下です：
- Painlessスクリプトは使えない → アプリケーション側で実装
- 複雑な集計（Aggregation）の一部機能 → Typesenseの集計機能で代替
- ネストフィールドの扱い → データモデルをフラット化

いずれも実装可能な範囲の制約です。

### Q4: 移行中に問題が発生した場合のロールバック方法は？

**A:** フィーチャーフラグで即座にロールバック可能です：
```typescript
const useTypesense = process.env.USE_TYPESENSE === 'true';

if (useTypesense) {
  return await searchWithTypesense(query);
} else {
  return await searchWithOpenSearch(query);
}
```

### Q5: マルチテナント環境でのコスト配分は？

**A:** 以下の方式を推奨します：
- 共有インフラ方式: 全テナントで1つのTypesenseクラスターを共有
- データはテナントIDでフィルタリング
- コストは使用量に応じて配分（検索クエリ数、データ量）

### Q6: Typesenseのバージョンアップはどのように行いますか？

**A:** ECS Fargateのローリングアップデート機能を使用：
```typescript
service.taskDefinition.defaultContainer.image =
  ecs.ContainerImage.fromRegistry('typesense/typesense:27.2');
```

ダウンタイムなしでアップデート可能です。

### Q7: パフォーマンスが期待通りでない場合の対策は？

**A:** 以下の最適化オプションがあります：
- FargateのvCPU/メモリを増強（0.5 → 1.0 vCPU）
- インデックス設定の調整（token separatorsなど）
- キャッシュレイヤーの追加（CloudFront、Redis）
- 検索クエリの最適化

---

## 参考資料

### 公式ドキュメント

- [Typesense Documentation](https://typesense.org/docs/)
- [Typesense API Reference](https://typesense.org/docs/latest/api/)
- [AWS ECS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)

### 関連ドキュメント

- [TYPESENSE_IMPLEMENTATION_GUIDE.md](./TYPESENSE_IMPLEMENTATION_GUIDE.md) - 実装の詳細ガイド
- [COST_OPTIMIZATION_ANALYSIS.md](./COST_OPTIMIZATION_ANALYSIS.md) - コスト分析レポート
- [DEPLOY_OPTION.md](./DEPLOY_OPTION.md) - デプロイオプション

### サンプルコード

- `packages/cdk/lib/construct/typesense-cluster.ts` - Typesense CDK construct
- `packages/cdk/lambda/syncToTypesense.ts` - データ同期Lambda
- `packages/cdk/lambda/searchTypesense.ts` - 検索Lambda

---

## 変更履歴

| 日付 | バージョン | 変更内容 | 著者 |
|------|-----------|---------|------|
| 2025-10-31 | 1.0.0 | 初版作成 | Claude |

---

## フィードバック

本ドキュメントに関するフィードバックは、以下のいずれかの方法でお願いします：

- GitHub Issue: https://github.com/fixer-github/generative-ai-use-cases/issues
- Pull Request: 修正提案をPRで送信

---

**次のステップ:**

1. [TYPESENSE_IMPLEMENTATION_GUIDE.md](./TYPESENSE_IMPLEMENTATION_GUIDE.md)で実装の詳細を確認
2. [COST_OPTIMIZATION_ANALYSIS.md](./COST_OPTIMIZATION_ANALYSIS.md)でコスト試算を確認
3. 実装計画を承認し、フェーズ1を開始
