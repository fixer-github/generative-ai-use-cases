# PPTX Data - DynamoDB → Aurora Serverless 移行計画

**作成日**: 2025-10-31
**対象**: PPTXテンプレート・ジェネレーションデータ
**ステータス**: 計画段階
**優先度**: 🟢 低（複雑クエリニーズ発生時に実施）

---

## 📋 エグゼクティブサマリー

### 概要

現在DynamoDBで管理している**PPTXテンプレート・ジェネレーションデータ**を**Aurora Serverless v2 (PostgreSQL)**に移行することで、複雑なリレーショナルクエリの効率化とデータ分析の柔軟性向上を実現します。

### 移行の是非

| 判断基準 | 現状 | 推奨 |
|---------|------|------|
| **複雑クエリの需要** | 低（シンプルなCRUD） | ❌ 移行不要 |
| **レポート機能** | なし | ❌ 移行不要 |
| **データ分析ニーズ** | なし | ❌ 移行不要 |
| **トランザクション要件** | 低 | ❌ 移行不要 |

**結論:** 現時点では移行を推奨しない。以下の条件が揃った場合に再検討。

### 移行を検討すべきタイミング

1. ✅ **レポート機能の実装**: テンプレート使用頻度ランキング、ユーザー別統計など
2. ✅ **複雑検索の需要**: 「ユーザーAのパブリックテンプレートを使った、チャットBのジェネレーション」のようなクエリ
3. ✅ **BIツール連携**: QuickSight、Tableau等でのダッシュボード作成
4. ✅ **データ整合性要件の向上**: ACID特性が必要な複雑なワークフロー

---

## 目次

1. [現状分析](#現状分析)
2. [Aurora Serverlessアーキテクチャ設計](#aurora-serverlessアーキテクチャ設計)
3. [スキーマ設計](#スキーマ設計)
4. [ORM選定](#orm選定)
5. [クエリパフォーマンス比較](#クエリパフォーマンス比較)
6. [コスト分析](#コスト分析)
7. [移行手順](#移行手順)

---

## 現状分析

### 現在のDynamoDB設計

**場所:** `packages/cdk/lib/construct/pptx-db.ts:65-148`

```typescript
// テンプレートテーブル
this.templatesTable = new dynamodb.Table(this, 'PptxTemplatesTable', {
  partitionKey: {
    name: 'templateId',
    type: dynamodb.AttributeType.STRING,
  },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
});

// GSI 1: ユーザー別検索
this.templatesTable.addGlobalSecondaryIndex({
  indexName: 'UserIndex',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});

// GSI 2: パブリックテンプレート検索
this.templatesTable.addGlobalSecondaryIndex({
  indexName: 'PublicIndex',
  partitionKey: { name: 'isPublic', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});

// ジェネレーションテーブル
this.generationsTable = new dynamodb.Table(this, 'PptxGenerationsTable', {
  partitionKey: {
    name: 'generationId',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'userId',
    type: dynamodb.AttributeType.STRING,
  },
});

// GSI 3: ユーザー別ジェネレーション
this.generationsTable.addGlobalSecondaryIndex({
  indexName: 'UserGenerationsIndex',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});

// GSI 4: チャット別ジェネレーション
this.generationsTable.addGlobalSecondaryIndex({
  indexName: 'ChatGenerationsIndex',
  partitionKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
});
```

### 現在のアクセスパターン

```typescript
// パターン1: テンプレート取得（ID）
const template = await dynamodb.get({
  TableName: 'pptx-templates',
  Key: { templateId: 'template-123' }
});

// パターン2: ユーザーのテンプレート一覧
const userTemplates = await dynamodb.query({
  TableName: 'pptx-templates',
  IndexName: 'UserIndex',
  KeyConditionExpression: 'userId = :userId',
  ExpressionAttributeValues: { ':userId': 'user-123' }
});

// パターン3: パブリックテンプレート一覧
const publicTemplates = await dynamodb.query({
  TableName: 'pptx-templates',
  IndexName: 'PublicIndex',
  KeyConditionExpression: 'isPublic = :true',
  ExpressionAttributeValues: { ':true': 'true' }
});

// ❌ 不可能なクエリ: テンプレートとジェネレーションのJOIN
// 「最も使われているパブリックテンプレートトップ10」
// → DynamoDBでは2回のクエリ + アプリケーション側でのJOINが必要
```

### DynamoDB設計の制約

1. ✗ **JOIN不可**: テンプレートとジェネレーションの関連付けが困難
2. ✗ **GSI乱立**: 各検索パターンに別GSIが必要
3. ✗ **複雑フィルタ困難**: 複数条件の組み合わせが非効率
4. ✗ **集計クエリ困難**: COUNT、SUM、AVGなどの集計

---

## Aurora Serverlessアーキテクチャ設計

### Aurora Serverless v2概要

**主要特徴:**
- **瞬時スケーリング**: 0.5 ACU〜128 ACU（1 ACU = 2GB RAM）
- **PostgreSQL 15互換**: 豊富な機能（JSONB、Full-text search、Window関数等）
- **サーバーレス課金**: 使用量ベース（最小0.5 ACU）

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                    Aurora Serverless v2                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           PostgreSQL Database Cluster                │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  Schema: pptx_data                           │    │  │
│  │  │                                              │    │  │
│  │  │  Tables:                                     │    │  │
│  │  │  - pptx_templates                            │    │  │
│  │  │  - pptx_generations                          │    │  │
│  │  │  - template_tags (多対多)                    │    │  │
│  │  │                                              │    │  │
│  │  │  Indexes:                                    │    │  │
│  │  │  - idx_user_created (user_id, created_at)   │    │  │
│  │  │  - idx_public_created (is_public, created)  │    │  │
│  │  │  - idx_template_id (FK)                      │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Scaling: 0.5 ACU (1GB) 〜 16 ACU (32GB)                   │
│  High Availability: Multi-AZ (Reader Endpoint)             │
└─────────────────────────────────────────────────────────────┘
                      ▲
        ┌─────────────┴─────────────┐
        │     Lambda Functions      │
        │   - Prisma ORM            │
        │   - Connection Pooling    │
        └───────────────────────────┘
```

---

## スキーマ設計

### PostgreSQLスキーマ

```sql
-- ============================================
-- PPTX Templates Table
-- ============================================
CREATE TABLE pptx_templates (
    template_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           VARCHAR(255) NOT NULL,
    tenant_id         VARCHAR(255) NOT NULL,
    name              VARCHAR(500) NOT NULL,
    description       TEXT,
    is_public         BOOLEAN DEFAULT false,

    -- メタデータ（JSONB型で柔軟に保存）
    template_data     JSONB,

    -- S3キー
    s3_key            VARCHAR(1000),

    -- タイムスタンプ
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ttl               TIMESTAMP,  -- 自動削除用

    -- 統計情報（非正規化）
    usage_count       INTEGER DEFAULT 0,
    last_used_at      TIMESTAMP,

    -- インデックス
    CONSTRAINT chk_name_not_empty CHECK (name <> '')
);

-- インデックス
CREATE INDEX idx_templates_user_created
    ON pptx_templates(user_id, created_at DESC);

CREATE INDEX idx_templates_public_created
    ON pptx_templates(is_public, created_at DESC)
    WHERE is_public = true;  -- Partial Index（パブリックのみ）

CREATE INDEX idx_templates_tenant
    ON pptx_templates(tenant_id);

-- Full-text search（オプション）
CREATE INDEX idx_templates_search
    ON pptx_templates USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- JSONB index（メタデータ検索用）
CREATE INDEX idx_templates_data
    ON pptx_templates USING gin(template_data);

-- ============================================
-- PPTX Generations Table
-- ============================================
CREATE TABLE pptx_generations (
    generation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id       UUID REFERENCES pptx_templates(template_id) ON DELETE CASCADE,
    user_id           VARCHAR(255) NOT NULL,
    chat_id           VARCHAR(255),
    tenant_id         VARCHAR(255) NOT NULL,
    status            VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
    result_data       JSONB,
    s3_key            VARCHAR(1000),
    error_message     TEXT,

    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at      TIMESTAMP,
    ttl               TIMESTAMP
);

-- インデックス
CREATE INDEX idx_generations_user_created
    ON pptx_generations(user_id, created_at DESC);

CREATE INDEX idx_generations_chat_created
    ON pptx_generations(chat_id, created_at DESC);

CREATE INDEX idx_generations_template
    ON pptx_generations(template_id);

CREATE INDEX idx_generations_status
    ON pptx_generations(status, created_at DESC);

-- ============================================
-- Template Tags Table（多対多）
-- ============================================
CREATE TABLE template_tags (
    template_id       UUID REFERENCES pptx_templates(template_id) ON DELETE CASCADE,
    tag               VARCHAR(100) NOT NULL,
    PRIMARY KEY (template_id, tag)
);

CREATE INDEX idx_tags_tag ON template_tags(tag);

-- ============================================
-- Triggers（自動更新）
-- ============================================
-- updated_at自動更新
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_templates_updated_at
    BEFORE UPDATE ON pptx_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- usage_count自動更新
CREATE OR REPLACE FUNCTION increment_template_usage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE pptx_templates
        SET usage_count = usage_count + 1,
            last_used_at = CURRENT_TIMESTAMP
        WHERE template_id = NEW.template_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_usage_on_generation
    AFTER INSERT ON pptx_generations
    FOR EACH ROW
    EXECUTE FUNCTION increment_template_usage();
```

### DynamoDB → PostgreSQL データマッピング

| DynamoDB | PostgreSQL | 変換 |
|----------|-----------|------|
| `templateId` (String) | `template_id` (UUID) | UUID変換 |
| `userId` (String) | `user_id` (VARCHAR) | そのまま |
| `isPublic` (String "true"/"false") | `is_public` (BOOLEAN) | BOOLEAN変換 |
| `template_data` (Map) | `template_data` (JSONB) | JSON変換 |
| `createdAt` (Number) | `created_at` (TIMESTAMP) | Unixタイム→TIMESTAMP |

---

## ORM選定

### Prisma（推奨）

**理由:**
- TypeScript ネイティブ
- 型安全性が高い
- マイグレーション管理が容易
- Lambda対応（Connection Pooling）

**Prismaスキーマ:**

```prisma
// packages/cdk/lambda/prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native", "rhel-openssl-1.0.x"]  // Lambda用
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model PptxTemplate {
  templateId    String   @id @default(uuid()) @map("template_id")
  userId        String   @map("user_id")
  tenantId      String   @map("tenant_id")
  name          String
  description   String?
  isPublic      Boolean  @default(false) @map("is_public")
  templateData  Json?    @map("template_data")
  s3Key         String?  @map("s3_key")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  ttl           DateTime?
  usageCount    Int      @default(0) @map("usage_count")
  lastUsedAt    DateTime? @map("last_used_at")

  generations   PptxGeneration[]
  tags          TemplateTag[]

  @@index([userId, createdAt(sort: Desc)], name: "idx_user_created")
  @@index([isPublic, createdAt(sort: Desc)], name: "idx_public_created")
  @@index([tenantId], name: "idx_tenant")
  @@map("pptx_templates")
}

model PptxGeneration {
  generationId  String    @id @default(uuid()) @map("generation_id")
  templateId    String    @map("template_id")
  userId        String    @map("user_id")
  chatId        String?   @map("chat_id")
  tenantId      String    @map("tenant_id")
  status        String    @default("pending")
  resultData    Json?     @map("result_data")
  s3Key         String?   @map("s3_key")
  errorMessage  String?   @map("error_message")
  createdAt     DateTime  @default(now()) @map("created_at")
  completedAt   DateTime? @map("completed_at")
  ttl           DateTime?

  template      PptxTemplate @relation(fields: [templateId], references: [templateId], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)], name: "idx_user_created")
  @@index([chatId, createdAt(sort: Desc)], name: "idx_chat_created")
  @@index([templateId], name: "idx_template")
  @@index([status, createdAt(sort: Desc)], name: "idx_status")
  @@map("pptx_generations")
}

model TemplateTag {
  templateId    String @map("template_id")
  tag           String

  template      PptxTemplate @relation(fields: [templateId], references: [templateId], onDelete: Cascade)

  @@id([templateId, tag])
  @@index([tag], name: "idx_tag")
  @@map("template_tags")
}
```

**使用例:**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// テンプレート作成
const template = await prisma.pptxTemplate.create({
  data: {
    userId: 'user-123',
    tenantId: 'tenant-1',
    name: 'My Template',
    description: 'A sample template',
    isPublic: true,
    templateData: {
      slides: 10,
      theme: 'modern',
    },
    tags: {
      create: [
        { tag: 'business' },
        { tag: 'presentation' },
      ],
    },
  },
});

// 複雑クエリ: 最も使われているパブリックテンプレートトップ10
const topTemplates = await prisma.pptxTemplate.findMany({
  where: {
    isPublic: true,
    tenantId: 'tenant-1',
  },
  orderBy: {
    usageCount: 'desc',
  },
  take: 10,
  include: {
    _count: {
      select: { generations: true },
    },
  },
});

// JOINクエリ: ユーザーAのテンプレートを使った、チャットBのジェネレーション
const generations = await prisma.pptxGeneration.findMany({
  where: {
    chatId: 'chat-B',
    template: {
      userId: 'user-A',
      isPublic: true,
    },
  },
  include: {
    template: {
      select: {
        name: true,
        description: true,
      },
    },
  },
  orderBy: {
    createdAt: 'desc',
  },
});
```

---

## クエリパフォーマンス比較

### シナリオ1: シンプルなCRUD

**DynamoDB:**
```typescript
// GetItem: 1ms〜3ms
const template = await dynamodb.get({
  TableName: 'pptx-templates',
  Key: { templateId: 'template-123' }
});
```

**Aurora (Prisma):**
```typescript
// SELECT: 5ms〜15ms（コネクション確立含む）
const template = await prisma.pptxTemplate.findUnique({
  where: { templateId: 'template-123' }
});
```

**結果:** DynamoDB有利（2〜5倍高速）

### シナリオ2: 複雑JOIN

**DynamoDB:**
```typescript
// 2回のクエリ + アプリケーション側でのJOIN
const templates = await dynamodb.query({ ... });  // 10ms
const generations = await dynamodb.query({ ... }); // 10ms
const joined = joinInMemory(templates, generations); // 5ms
// 合計: 25ms + 複雑なコード
```

**Aurora (Prisma):**
```typescript
// 1回のJOINクエリ
const result = await prisma.pptxTemplate.findMany({
  where: { isPublic: true },
  include: {
    generations: {
      where: { chatId: 'chat-B' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    },
  },
});
// 合計: 15ms〜30ms + シンプルなコード
```

**結果:** Aurora有利（コードがシンプル、メンテナンス性高）

### シナリオ3: 集計クエリ

**DynamoDB:**
```typescript
// Scan（全件取得） + アプリケーション側で集計
const allTemplates = await dynamodb.scan({ ... });  // 100ms〜1000ms（データ量による）
const stats = calculateStats(allTemplates.Items);   // 50ms
// 合計: 150ms〜1050ms
```

**Aurora (Prisma):**
```typescript
// SQL集計
const stats = await prisma.$queryRaw`
  SELECT
    COUNT(*) as total_templates,
    COUNT(*) FILTER (WHERE is_public = true) as public_templates,
    AVG(usage_count) as avg_usage
  FROM pptx_templates
  WHERE tenant_id = 'tenant-1'
`;
// 合計: 10ms〜50ms
```

**結果:** Aurora圧勝（10〜100倍高速）

---

## コスト分析

### 現状（DynamoDB）

**月間データ（10テナント）:**
- テンプレート: 10,000件
- ジェネレーション: 100,000件
- 読み取り: 100万リクエスト/月
- 書き込み: 10万リクエスト/月

```
読み取り: 1,000,000 × $0.25/100万 = $2.50
書き込み: 100,000 × $1.25/100万 = $1.25
ストレージ: 5GB × $0.25 = $1.25
合計: $5.00/月 → $60/年
```

### Aurora Serverless v2

**最小構成（0.5 ACU）:**
```
ACU: 0.5 ACU × 720時間 × $0.12/ACU時 = $43.20/月
ストレージ: 5GB × $0.10 = $0.50/月
I/O: 1,000,000リクエスト × $0.20/100万 = $0.20/月
合計: $43.90/月 → $527/年

年間追加コスト: $467
```

**最適化構成（スケジュールスケーリング）:**
```
営業時間のみ稼働（月間360時間）:
  ACU: 0.5 × 360 × $0.12 = $21.60/月
  ストレージ: $0.50/月
  I/O: $0.20/月
  合計: $22.30/月 → $268/年

年間追加コスト: $208
```

---

## 移行手順

### 前提条件確認

以下のいずれかが満たされた場合に移行を検討：
- ✅ レポート機能の実装が決定
- ✅ BIツール連携の要件
- ✅ 複雑クエリの需要（週1回以上）

### フェーズ1: 準備（2週間）

1. ✅ Aurora Serverless v2クラスター作成
2. ✅ Prismaセットアップ
3. ✅ スキーマ作成
4. ✅ データ移行スクリプト作成

### フェーズ2: データ移行（1週間）

1. ✅ DynamoDB → S3 エクスポート
2. ✅ S3 → Aurora インポート
3. ✅ データ整合性検証

### フェーズ3: アプリケーション移行（3週間）

1. ✅ Prisma Clientコード実装
2. ✅ ユニットテスト
3. ✅ フィーチャーフラグで段階的切り替え

---

## 次のステップ

### 現時点（移行不要と判断）

1. ✅ このドキュメントをレビュー承認
2. ✅ 定期的に移行ニーズを再評価（3ヶ月ごと）
3. ✅ DynamoDB設計の改善検討

### 移行決定時

1. **1週間以内**: Aurora環境構築
2. **2週間以内**: Prisma実装
3. **1ヶ月以内**: データ移行
4. **2ヶ月以内**: 本番切り替え

---

## 参考リソース

- [Aurora Serverless v2 Documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**変更履歴:**

| 日付 | 変更内容 | 作成者 |
|------|---------|--------|
| 2025-10-31 | 初版作成 | Claude Code Analysis |
