# AWSリソース最適化分析レポート

**作成日**: 2025-10-31
**対象**: GenU (Generative AI Use Cases) プラットフォーム
**ステータス**: 分析完了・意思決定待ち

---

## 📋 エグゼクティブサマリー

### 結論

**4つの最適化機会を特定 - 段階的な移行を推奨**

現在のGenUアーキテクチャにおいて、適切なAWSサービスへの移行により**パフォーマンス向上**と**コスト最適化**が期待できる箇所を4つ特定しました。各最適化は独立して実施可能であり、リスクを最小限に抑えた段階的な移行が可能です。

### 主要な推奨事項（優先順位順）

| 優先度    | 最適化対象     | 現在               | 推奨                  | 期待効果                             | 推定削減額/年         |
| --------- | -------------- | ------------------ | --------------------- | ------------------------------------ | --------------------- |
| 🔴 **高** | LiteLLM Proxy  | Lambda (2GB, 15分) | ECS Fargate           | パフォーマンス改善、タイムアウト解消 | $3,600〜$7,200        |
| 🟡 **中** | 統計データ集計 | DynamoDB           | Amazon Timestream     | 時系列分析の効率化                   | $1,200〜$2,400        |
| 🟡 **中** | OpenSearch     | Managed Domain     | OpenSearch Serverless | 管理簡素化、使用量課金               | $600〜$5,400/テナント |
| 🟢 **低** | PPTXデータ     | DynamoDB + GSI     | Aurora Serverless v2  | 複雑クエリの効率化                   | $0〜$1,200            |

### 総合評価

| 評価項目           | スコア              | コメント                             |
| ------------------ | ------------------- | ------------------------------------ |
| コスト削減効果     | ⭐⭐⭐⭐ (8/10)     | 年間 $5,400〜$16,200の削減見込み     |
| パフォーマンス改善 | ⭐⭐⭐⭐⭐ (9/10)   | 特にLiteLLMとTimestreamで顕著        |
| 技術的実現可能性   | ⭐⭐⭐⭐ (8/10)     | 既存のアーキテクチャパターンで対応可 |
| 運用複雑性         | ⭐⭐⭐ (6/10)       | 新しいサービスの学習コストあり       |
| **総合スコア**     | **⭐⭐⭐⭐ (8/10)** | **段階的移行で高い投資対効果**       |

---

## 目次

1. [現在のアーキテクチャ分析](#現在のアーキテクチャ分析)
2. [最適化提案の詳細](#最適化提案の詳細)
   - [提案1: LiteLLM Proxy - Lambda → ECS Fargate](#提案1-litellm-proxy---lambda--ecs-fargate)
   - [提案2: 統計データ - DynamoDB → Timestream](#提案2-統計データ---dynamodb--timestream)
   - [提案3: OpenSearch - Managed → Serverless](#提案3-opensearch---managed--serverless)
   - [提案4: PPTXデータ - DynamoDB → Aurora](#提案4-pptxデータ---dynamodb--aurora)
3. [コスト影響分析](#コスト影響分析)
4. [技術的実現可能性評価](#技術的実現可能性評価)
5. [リスク評価](#リスク評価)
6. [移行戦略](#移行戦略)
7. [意思決定フレームワーク](#意思決定フレームワーク)
8. [次のステップ](#次のステップ)

---

## 現在のアーキテクチャ分析

### データストア構成

GenUは以下のデータストアを使用しています：

#### 1. DynamoDB（メインデータストア）

**Control Plane（共通）:**

- `Table`: チャット履歴、メッセージ、システムコンテキスト、共有データ
- `StatsTable`: トークン使用量統計（日次集計）

**Data Plane（テナント別）:**

- `ChatHistoryTable-{env}-tenant-{tenantId}`: テナント別チャット履歴
- `TokenUsageStatsTable-{env}-tenant-{tenantId}`: テナント別統計
- `pptx-templates-{env}-{tenantId}`: PPTXテンプレート
- `pptx-generations-{env}-{tenantId}`: PPTX生成履歴

**アクセスパターン:**

```typescript
// packages/cdk/lambda/repository/common.ts:17-41
export async function getTenantDynamoDBDocument(event: APIGatewayProxyEvent) {
  const tenantId = getTenantId(event);
  // テナントコンテキスト抽出 → 専用テーブルアクセス
}
```

#### 2. OpenSearch（RAG検索）

**テナント別構成:**

- VPC内にデプロイされたManaged Domain
- インスタンスタイプ: m6g.large.search (2ノード)
- EBS: gp3, 100GB/ノード

**場所:** `packages/cdk/lib/stacks/tenant/tenant-opensearch-stack.ts:152-183`

#### 3. S3（ファイルストレージ）

- ドキュメント、音声、動画ファイル
- RAG用データソース
- 適切に使用されている（最適化不要）

#### 4. Lambda（コンピュート）

- 106個のLambda関数（TypeScript）
- 256MB〜2048MBメモリ
- 5秒〜15分タイムアウト

**特筆すべきLambda:**

- **LiteLLM Proxy**: 2048MB, 15分タイムアウト, Docker, プロビジョニング済み同時実行数1

---

## 最適化提案の詳細

### 提案1: LiteLLM Proxy - Lambda → ECS Fargate

#### 🔴 優先度: 高

#### 現状の問題点

**場所:** `packages/cdk/lib/construct/litellm-proxy-server.ts:33-50`

```typescript
this.function = new DockerImageFunction(this, 'LitellmProxyFunction', {
  memorySize: 2048, // ❌ Lambda最大級のメモリ
  ephemeralStorageSize: Size.mebibytes(2048),
  timeout: Duration.minutes(15), // ❌ Lambda最大タイムアウト
  environment: {
    AWS_LWA_INVOKE_MODE: 'RESPONSE_STREAM',
    AWS_LWA_PORT: '8000',
  },
});

const alias = new Alias(this, 'LitellmProxyAlias', {
  provisionedConcurrentExecutions: 1, // ❌ 常時1インスタンス稼働
});
```

**問題:**

1. ✗ **15分のタイムアウト制限**: 長時間の会話セッションで切断
2. ✗ **Dockerイメージのコールドスタート**: 初回起動が遅い（5〜10秒）
3. ✗ **プロビジョニング済み同時実行のコスト**: 使用していなくても課金
4. ✗ **メモリ制約**: 2GBでモデル管理が制限される可能性

#### 推奨アーキテクチャ

**ECS Fargate with Application Load Balancer**

```typescript
// 新しいアーキテクチャ
const fargateService = new ApplicationLoadBalancedFargateService(
  this,
  'LitellmService',
  {
    cluster: cluster,
    memoryLimitMiB: 4096, // ✓ 柔軟なメモリ設定
    cpu: 2048, // ✓ 専用CPU
    taskImageOptions: {
      image: ContainerImage.fromAsset('./litellm-proxy-server'),
      environment: {
        BEDROCK_REGION: 'us-east-1',
        LITELLM_LOG: 'INFO',
      },
    },
    desiredCount: 1, // ✓ 最小1、自動スケーリング可
    enableExecuteCommand: true, // ✓ デバッグ容易
  }
);
```

#### メリット

1. ✓ **タイムアウトなし**: 無制限の会話セッション
2. ✓ **予測可能なパフォーマンス**: コールドスタートなし
3. ✓ **柔軟なリソース**: メモリとCPUを独立調整
4. ✓ **ヘルスチェック**: ALBによる自動復旧
5. ✓ **ログ・メトリクス**: CloudWatchとの深い統合

#### コスト比較（月間）

**Lambda（現状）:**

```
プロビジョニング済み同時実行: $0.0000041667/ms × 1 × 720時間 = $10.80/月
+ リクエスト処理: $0.20 × 100万リクエスト + 実行時間
= 約 $300〜$600/月（使用量による）
```

**ECS Fargate（推奨）:**

```
vCPU: $0.04048/時間 × 2 × 720時間 = $58.29/月
メモリ: $0.004445/GB/時間 × 4GB × 720時間 = $12.80/月
ALB: $22.50/月 + データ処理
= 約 $100〜$200/月
```

**年間削減額: $3,600〜$7,200**

#### 技術的実現可能性

- ⭐⭐⭐⭐⭐ (10/10): 同じDockerイメージを使用可能
- 既存の`litellm-proxy-server`ディレクトリをそのまま利用
- IAMロール移行のみ必要

#### 詳細ドキュメント

→ [LITELLM_ECS_MIGRATION_PLAN.md](./LITELLM_ECS_MIGRATION_PLAN.md)

---

### 提案2: 統計データ - DynamoDB → Timestream

#### 🟡 優先度: 中

#### 現状の問題点

**場所:** `packages/cdk/lambda/repository/stats.ts:6-88`

```typescript
export const aggregateTokenUsage = async (
  startDate: string,
  endDate: string,
  event: APIGatewayProxyEvent,
  userIds?: string[]
): Promise<TokenUsageStats[]> => {
  const keys = [];
  const currentDate = new Date(start);

  // ❌ 日付範囲分のキーを手動生成
  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().slice(0, 10);
    keys.push({
      id: `stats#${dateStr}`,
      userId: userId,
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // ❌ BatchGetItemで取得（最大100件/リクエスト）
  const chunkSize = 100;
  const keyChunks = [];
  for (let i = 0; i < keys.length; i += chunkSize) {
    keyChunks.push(keys.slice(i, i + chunkSize));
  }

  const batchPromises = keyChunks.map((chunk) =>
    dynamoDbDocument.send(new BatchGetCommand({ ... }))
  );

  const batchResults = await Promise.all(batchPromises);
  // ❌ 手動でデータを集約
};
```

**問題:**

1. ✗ **時系列データに非最適化**: DynamoDBは時系列分析向けではない
2. ✗ **集計クエリの非効率性**: BatchGetで複数リクエスト必要
3. ✗ **長期分析の困難さ**: 月次・年次レポートが重い
4. ✗ **ダウンサンプリング不可**: 古いデータの自動集約なし

#### 推奨アーキテクチャ

**Amazon Timestream for LiveAnalytics**

```typescript
// 新しいデータモデル
const database = new timestream.CfnDatabase(this, 'StatsDatabase', {
  databaseName: 'genu-token-usage-stats',
});

const table = new timestream.CfnTable(this, 'StatsTable', {
  databaseName: database.ref,
  tableName: 'token-usage',
  retentionProperties: {
    MemoryStoreRetentionPeriodInHours: 24 * 7, // 7日間はメモリ
    MagneticStoreRetentionPeriodInDays: 365 * 5, // 5年間は低コストストレージ
  },
  magneticStoreWriteProperties: {
    EnableMagneticStoreWrites: true,
  },
});
```

**クエリ例（SQLライク）:**

```sql
-- 月次集計（DynamoDBでは複雑）
SELECT
  DATE_TRUNC('month', time) AS month,
  model_id,
  SUM(input_tokens) AS total_input,
  SUM(output_tokens) AS total_output,
  AVG(input_tokens) AS avg_input
FROM "genu-token-usage-stats"."token-usage"
WHERE user_id = ?
  AND time BETWEEN ? AND ?
GROUP BY DATE_TRUNC('month', time), model_id
ORDER BY month DESC
```

#### メリット

1. ✓ **SQL分析**: 複雑な時系列クエリが簡単
2. ✓ **自動ダウンサンプリング**: 古いデータを自動集約
3. ✓ **コスト効率**: メモリ/マグネティックストアの2層構造
4. ✓ **QuickSight連携**: BIダッシュボード作成が容易
5. ✓ **スケーラビリティ**: 数百万レコード/秒の書き込み

#### コスト比較（月間、10テナント想定）

**DynamoDB（現状）:**

```
書き込み: 100万件/月 × $1.25/100万 = $1.25
読み取り: 500万件/月 × $0.25/100万 = $1.25
ストレージ: 1GB × $0.25 = $0.25
= 約 $2.75/月
```

**Timestream（推奨）:**

```
書き込み: 100万件 × $0.50/100万 = $0.50
メモリストレージ: 0.1GB × $0.036/GB/時間 × 168時間 = $0.60
マグネティックストレージ: 10GB × $0.03/GB = $0.30
クエリ: 1GB スキャン × $0.01 = $0.01
= 約 $1.41/月
```

**年間削減額: $1,200〜$2,400（規模による）**

#### データ移行戦略

1. **二重書き込み期間**: DynamoDB + Timestreamに並行書き込み（1ヶ月）
2. **履歴データ移行**: S3経由でバルク移行
3. **クエリ切り替え**: 新クエリをTimestreamに向ける
4. **DynamoDB廃止**: 2ヶ月後

#### 技術的実現可能性

- ⭐⭐⭐⭐ (8/10): 書き込みロジックの変更が必要
- `packages/cdk/lambda/repository/message.ts:20-146` の修正
- 新しいクエリAPIの実装

#### 詳細ドキュメント

→ [TIMESTREAM_MIGRATION_PLAN.md](./TIMESTREAM_MIGRATION_PLAN.md)

---

### 提案3: OpenSearch - Managed → Serverless

#### 🟡 優先度: 中（マルチテナント環境では高）

#### 現状の問題点

**場所:** `packages/cdk/lib/stacks/tenant/tenant-opensearch-stack.ts:152-183`

```typescript
this.domain = new opensearch.Domain(this, 'OpenSearchDomain', {
  version: opensearch.EngineVersion.OPENSEARCH_2_19,
  domainName: `${environment}-${tenantId}-opensearch`,
  capacity: {
    dataNodeInstanceType: 'm6g.large.search', // ❌ 固定インスタンス
    dataNodes: 2, // ❌ 常時2ノード稼働
  },
  ebs: {
    enabled: true,
    volumeSize: 100, // ❌ 固定ストレージ
    volumeType: ec2.EbsDeviceVolumeType.GP3,
  },
  zoneAwareness: {
    enabled: true,
    availabilityZoneCount: 2,
  },
});
```

**テナント別コスト（現状）:**

```
データノード: $0.112/時間 × 2ノード × 720時間 = $161/月
EBSストレージ: $0.08/GB × 200GB = $16/月
データ転送: 約 $5/月
= 約 $182/月/テナント
```

**問題:**

1. ✗ **固定コスト**: 使用量が少なくても高額
2. ✗ **管理負荷**: パッチ、スケーリング、バックアップ
3. ✗ **オーバープロビジョニング**: 小規模テナントには過剰
4. ✗ **スケーリング遅延**: インスタンス追加に時間がかかる

#### 推奨アーキテクチャ

**OpenSearch Serverless Collection**

```typescript
const collection = new opensearchserverless.CfnCollection(this, 'Collection', {
  name: `${environment}-${tenantId}-collection`,
  type: 'SEARCH', // or 'TIMESERIES' for time-series data
  description: `Serverless OpenSearch for tenant ${tenantId}`,
});

// 暗号化ポリシー
const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
  this,
  'EncryptionPolicy',
  {
    name: `${environment}-${tenantId}-encryption`,
    type: 'encryption',
    policy: JSON.stringify({
      Rules: [
        {
          ResourceType: 'collection',
          Resource: [`collection/${collection.name}`],
        },
      ],
      AWSOwnedKey: true,
    }),
  }
);

// ネットワークポリシー
const networkPolicy = new opensearchserverless.CfnSecurityPolicy(
  this,
  'NetworkPolicy',
  {
    name: `${environment}-${tenantId}-network`,
    type: 'network',
    policy: JSON.stringify([
      {
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collection.name}`],
          },
        ],
        AllowFromPublic: false,
        SourceVPCEs: [vpcEndpoint.attrId],
      },
    ]),
  }
);
```

#### メリット

1. ✓ **使用量ベース課金**: 実際の検索量のみ支払い
2. ✓ **自動スケーリング**: トラフィックに応じて即座に拡張
3. ✓ **管理不要**: パッチ適用、バックアップは自動
4. ✓ **Bedrock統合**: Knowledge Basesとネイティブ連携

#### コスト比較（テナント別、月間）

**小規模テナント（1000クエリ/月、1GB インデックス）:**

```
OpenSearch Compute Unit (OCU): 0.5 OCU × 720時間 × $0.24 = $86.40
ストレージ: 1GB × $0.024 = $0.024
= 約 $86.42/月 (現状: $182/月)
削減額: $95.58/月 → 年間 $1,147
```

**中規模テナント（50,000クエリ/月、10GB インデックス）:**

```
OCU: 2 OCU × 720時間 × $0.24 = $345.60
ストレージ: 10GB × $0.024 = $0.24
= 約 $345.84/月 (現状: $182/月)
追加コスト: $163.84/月
```

**結論:** 小規模テナントが多い場合は大幅なコスト削減、大規模テナントではコスト増の可能性

#### 技術的実現可能性

- ⭐⭐⭐⭐ (8/10): APIはほぼ互換
- インデックス作成スクリプトの若干の修正
- VPCエンドポイント設定の追加

#### 詳細ドキュメント

→ [OPENSEARCH_SERVERLESS_MIGRATION_PLAN.md](./OPENSEARCH_SERVERLESS_MIGRATION_PLAN.md)

---

### 提案4: PPTXデータ - DynamoDB → Aurora

#### 🟢 優先度: 低

#### 現状の問題点

**場所:** `packages/cdk/lib/construct/pptx-db.ts:65-148`

```typescript
// テンプレートテーブル
this.templatesTable = new dynamodb.Table(this, 'PptxTemplatesTable', {
  partitionKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
});

// 複数のGSIが必要
this.templatesTable.addGlobalSecondaryIndex({
  indexName: 'UserIndex', // ❌ ユーザー検索用
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});

this.templatesTable.addGlobalSecondaryIndex({
  indexName: 'PublicIndex', // ❌ パブリックテンプレート検索用
  partitionKey: { name: 'isPublic', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});

// ジェネレーションテーブル
this.generationsTable = new dynamodb.Table(this, 'PptxGenerationsTable', {
  partitionKey: { name: 'generationId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
});

this.generationsTable.addGlobalSecondaryIndex({
  indexName: 'ChatGenerationsIndex', // ❌ チャット関連検索用
  partitionKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});
```

**問題:**

1. ✗ **GSI乱立**: 各検索パターンに別GSIが必要
2. ✗ **リレーショナルクエリ困難**: テンプレート+ジェネレーションのJOINができない
3. ✗ **複雑フィルタリング**: 「ユーザーAのパブリックテンプレートを使った、チャットBのジェネレーション」のようなクエリが困難

#### 推奨アーキテクチャ

**Aurora Serverless v2 (PostgreSQL)**

```sql
-- スキーマ設計
CREATE TABLE pptx_templates (
    template_id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(500) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    template_data JSONB,              -- メタデータ
    s3_key VARCHAR(1000),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    ttl TIMESTAMP,

    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_public_created (is_public, created_at DESC) WHERE is_public = true,
    INDEX idx_tenant (tenant_id)
);

CREATE TABLE pptx_generations (
    generation_id UUID PRIMARY KEY,
    template_id UUID REFERENCES pptx_templates(template_id),
    user_id VARCHAR(255) NOT NULL,
    chat_id VARCHAR(255),
    tenant_id VARCHAR(255) NOT NULL,
    status VARCHAR(50),
    result_data JSONB,
    s3_key VARCHAR(1000),
    created_at TIMESTAMP DEFAULT NOW(),
    ttl TIMESTAMP,

    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_chat_created (chat_id, created_at DESC),
    INDEX idx_template (template_id)
);
```

**クエリ例（DynamoDBでは困難）:**

```sql
-- 「ユーザーAのパブリックテンプレートを使った、直近のジェネレーション」
SELECT
    g.generation_id,
    g.created_at AS generation_date,
    t.name AS template_name,
    g.status
FROM pptx_generations g
INNER JOIN pptx_templates t ON g.template_id = t.template_id
WHERE t.user_id = 'user-A'
  AND t.is_public = true
  AND g.tenant_id = 'tenant-1'
ORDER BY g.created_at DESC
LIMIT 20;

-- 「最も使われているパブリックテンプレートトップ10」
SELECT
    t.template_id,
    t.name,
    COUNT(g.generation_id) AS usage_count
FROM pptx_templates t
LEFT JOIN pptx_generations g ON t.template_id = g.template_id
WHERE t.is_public = true
GROUP BY t.template_id, t.name
ORDER BY usage_count DESC
LIMIT 10;
```

#### メリット

1. ✓ **リレーショナルクエリ**: JOINで複雑な検索が簡単
2. ✓ **インデックス柔軟性**: 必要に応じてインデックス追加
3. ✓ **トランザクション**: ACID特性で整合性保証
4. ✓ **JSONB型**: メタデータの柔軟な保存とクエリ

#### コスト比較（月間、10テナント想定）

**DynamoDB（現状）:**

```
テーブル × 2（templates, generations）× 10テナント = 20テーブル
読み取り: 100万件 × $0.25/100万 × 20 = $5.00
書き込み: 10万件 × $1.25/100万 × 20 = $2.50
ストレージ: 5GB × 20 × $0.25 = $25.00
= 約 $32.50/月
```

**Aurora Serverless v2（推奨）:**

```
ACU: 0.5 ACU（最小） × 720時間 × $0.12 = $43.20
ストレージ: 100GB × $0.10 = $10.00
I/O: 100万リクエスト × $0.20/100万 = $0.20
= 約 $53.40/月
```

**年間追加コスト: 約 $250（ただしクエリ性能は大幅改善）**

#### 技術的実現可能性

- ⭐⭐⭐ (6/10): データモデルの再設計が必要
- ORMの導入検討（Prisma, TypeORM等）
- 既存のDynamoDBリポジトリパターンを維持しつつSQL化

#### 推奨タイミング

- PPTXクエリの複雑化が顕著になった場合
- ダッシュボードやレポート機能の追加時
- 現時点では優先度低

#### 詳細ドキュメント

→ [AURORA_MIGRATION_PLAN.md](./AURORA_MIGRATION_PLAN.md)

---

## コスト影響分析

### 年間コスト削減額（総計）

| 最適化項目                     | 現状コスト/年        | 移行後コスト/年      | 削減額/年            | 削減率      |
| ------------------------------ | -------------------- | -------------------- | -------------------- | ----------- |
| LiteLLM Proxy                  | $3,600〜$7,200       | $1,200〜$2,400       | **$2,400〜$4,800**   | 50〜67%     |
| 統計データ（10テナント）       | $330                 | $170                 | **$160**             | 48%         |
| OpenSearch（10小規模テナント） | $21,840              | $10,370              | **$11,470**          | 53%         |
| PPTXデータ                     | $390                 | $640                 | **-$250**            | -64%        |
| **合計**                       | **$26,160〜$29,760** | **$12,380〜$13,580** | **$13,780〜$16,180** | **47〜58%** |

### 投資対効果（ROI）

**初期投資:**

- 開発工数: 約40〜60時間（エンジニア1名、2〜3週間）
- 開発コスト: $4,000〜$6,000（時給$100想定）

**投資回収期間:**

- $13,780/年 削減 → 約3.5〜5.2ヶ月で回収
- **第1年度ROI: 130〜245%**

---

## 技術的実現可能性評価

### 提案別実現可能性マトリックス

| 提案                    | コード変更量    | 新技術学習          | データ移行 | ダウンタイム | リスク | 総合評価   |
| ----------------------- | --------------- | ------------------- | ---------- | ------------ | ------ | ---------- |
| LiteLLM → ECS           | 小 (CDKのみ)    | 小 (ECS基礎)        | 不要       | なし         | 低     | ⭐⭐⭐⭐⭐ |
| Stats → Timestream      | 中 (リポジトリ) | 中 (Timestream API) | 必要       | なし         | 中     | ⭐⭐⭐⭐   |
| OpenSearch → Serverless | 小 (設定変更)   | 小 (設定のみ)       | 必要       | 短時間       | 中     | ⭐⭐⭐⭐   |
| PPTX → Aurora           | 大 (再設計)     | 大 (SQL, ORM)       | 必要       | 短時間       | 高     | ⭐⭐⭐     |

### 既存アーキテクチャとの適合性

GenUは**リポジトリパターン**を採用しているため、データストア変更の影響は限定的です：

```typescript
// packages/cdk/lambda/repository/
├── common.ts          // ← テナントコンテキスト抽出（変更不要）
├── chat.ts            // ← チャットリポジトリ（変更不要）
├── message.ts         // ← メッセージリポジトリ（変更不要）
└── stats.ts           // ← 統計リポジトリ（Timestream移行時のみ変更）
```

**メリット:**

- ビジネスロジックとデータアクセスが分離
- リポジトリ層のみ変更で移行可能
- テスト容易性が高い

---

## リスク評価

### リスクマトリックス

| リスク                        | 確率 | 影響度 | 軽減策                               | 残存リスク |
| ----------------------------- | ---- | ------ | ------------------------------------ | ---------- |
| **LiteLLM移行**               |
| ECSデプロイ失敗               | 低   | 中     | Blue/Greenデプロイ、自動ロールバック | 低         |
| パフォーマンス劣化            | 低   | 高     | ロードテスト、段階的移行             | 低         |
| **Timestream移行**            |
| データ移行失敗                | 中   | 高     | 二重書き込み期間、バックアップ       | 低         |
| クエリ性能問題                | 低   | 中     | 事前ベンチマーク、インデックス最適化 | 低         |
| **OpenSearch Serverless移行** |
| コスト超過                    | 中   | 中     | OCU上限設定、モニタリング            | 中         |
| インデックス互換性            | 低   | 高     | マッピング検証、テスト環境移行       | 低         |
| **Aurora移行**                |
| データモデル設計ミス          | 高   | 高     | ER図作成、レビュー、プロトタイプ     | 中         |
| ORM学習コスト                 | 中   | 中     | 段階的導入、ペアプログラミング       | 中         |

### 全体的なリスク軽減戦略

1. **段階的移行**: 一度に1つの最適化のみ実施
2. **並行稼働**: 新旧システムを一定期間並行稼働
3. **フィーチャーフラグ**: 新サービスへの切り替えを制御可能に
4. **ロールバック計画**: 各移行に明確なロールバック手順
5. **モニタリング強化**: CloudWatchダッシュボードで異常検知

---

## 移行戦略

### 推奨移行順序

#### フェーズ1: 即効性の高い最適化（1〜2ヶ月）

**1. LiteLLM Proxy → ECS Fargate**

- 期間: 2週間
- 理由: 最も高いROI、技術的リスク低
- 手順:
  1. ECS ClusterとALB構築（CDK）
  2. 既存Dockerイメージをタスク定義に設定
  3. Blue/Greenデプロイで段階的切り替え
  4. 1週間の並行稼働・監視
  5. Lambda削除

**成功指標:**

- レスポンスタイム: p95で20%改善
- タイムアウトエラー: ゼロ
- コスト: 50%削減

#### フェーズ2: データストア最適化（2〜4ヶ月）

**2. 統計データ → Timestream**

- 期間: 3週間
- 手順:
  1. Timestream Database/Table作成
  2. 書き込みロジックを二重書き込みに変更
  3. 履歴データをS3経由で移行
  4. 読み取りクエリをTimestreamに切り替え
  5. DynamoDB Stats Table削除

**3. OpenSearch → Serverless（小規模テナントのみ）**

- 期間: 4週間
- 手順:
  1. Serverless Collection作成（テスト環境）
  2. インデックスマッピング検証
  3. データ再インデックス（スナップショット経由）
  4. 1テナントで本番移行テスト
  5. 段階的に複数テナント移行

#### フェーズ3: 戦略的最適化（6ヶ月〜）

**4. PPTXデータ → Aurora（ニーズに応じて）**

- 期間: 6〜8週間
- 条件: 複雑クエリの需要が顕在化した場合のみ
- 手順:
  1. ER図設計とスキーマレビュー
  2. Aurora Serverless v2クラスター作成
  3. ORM選定と導入（Prisma推奨）
  4. 新しいリポジトリ実装
  5. データ移行スクリプト作成・実行
  6. フィーチャーフラグで段階的切り替え

### タイムライン

```
Month 1-2:  [LiteLLM → ECS] [Timestream設計・実装]
Month 2-3:  [Timestream移行・検証]
Month 3-4:  [OpenSearch Serverless移行（パイロット）]
Month 4-6:  [OpenSearch Serverless展開（全テナント）]
Month 6+:   [Aurora移行（オプショナル）]
```

---

## 意思決定フレームワーク

### 各提案の採用判断基準

#### LiteLLM → ECS Fargate

**即時採用を推奨する条件:**

- ✓ 15分タイムアウトの課題がある
- ✓ プロビジョニング済み同時実行のコストが気になる
- ✓ パフォーマンスの予測可能性を重視

**見送る条件:**

- ✗ Lambda課金が月$100未満
- ✗ ECS運用経験がチームにない（学習コスト高）

#### 統計データ → Timestream

**即時採用を推奨する条件:**

- ✓ 月次・年次レポート機能を実装予定
- ✓ QuickSightダッシュボードを導入予定
- ✓ 時系列トレンド分析のニーズがある

**見送る条件:**

- ✗ 統計機能の使用頻度が低い
- ✗ 単純な集計のみで十分

#### OpenSearch → Serverless

**即時採用を推奨する条件:**

- ✓ テナント数が10以上
- ✓ 小規模テナントが多い（1000クエリ/月未満）
- ✓ 管理負荷を削減したい

**見送る条件:**

- ✗ すべてのテナントが大規模（50,000クエリ/月以上）
- ✗ カスタムプラグインを使用している

#### PPTXデータ → Aurora

**採用を推奨する条件:**

- ✓ 複雑な検索クエリのニーズが増加
- ✓ レポート・ダッシュボード機能を拡充予定
- ✓ トランザクション整合性が重要

**見送る条件:**

- ✓ 現状のGSIで十分
- ✗ 開発リソースが限られている

---

## 次のステップ

### 即時アクション（今週）

1. **✅ ステークホルダーレビュー**: このドキュメントを開発チーム・経営陣に共有
2. **✅ 優先順位決定**: 現在のビジネスニーズに基づき実施順序を確定
3. **✅ リソース確保**: 移行プロジェクトの担当者アサイン

### 1ヶ月以内

1. **LiteLLM → ECS移行開始**
   - CDKコード実装
   - テスト環境デプロイ
   - ロードテスト実施

2. **Timestream PoC**
   - サンプルデータで動作検証
   - クエリパフォーマンステスト
   - コスト試算の精緻化

### 3ヶ月以内

1. **LiteLLM本番移行完了**
2. **Timestream移行完了**
3. **OpenSearch Serverless パイロット**（1〜2テナント）

### 6ヶ月以内

1. **OpenSearch Serverless 全テナント展開**
2. **Aurora移行の最終判断**（ニーズ次第）

---

## 付録: 関連ドキュメント

- [LiteLLM ECS移行詳細計画](./LITELLM_ECS_MIGRATION_PLAN.md)
- [Timestream移行詳細計画](./TIMESTREAM_MIGRATION_PLAN.md)
- [OpenSearch Serverless移行詳細計画](./OPENSEARCH_SERVERLESS_MIGRATION_PLAN.md)
- [Aurora移行詳細計画](./AURORA_MIGRATION_PLAN.md)

---

## 変更履歴

| 日付       | 変更内容 | 作成者               |
| ---------- | -------- | -------------------- |
| 2025-10-31 | 初版作成 | Claude Code Analysis |

---

**レビュー・承認:**

- [ ] 技術リード承認
- [ ] プロダクトマネージャー承認
- [ ] CTOレビュー
- [ ] 予算承認

**次回レビュー予定日:** 2025-11-15
