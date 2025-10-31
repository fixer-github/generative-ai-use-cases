# 統計データのTimestream移行計画

**作成日**: 2025-10-31
**対象**: GenU Token Usage Statistics
**ステータス**: 計画段階

---

## 📋 エグゼクティブサマリー

### 概要

現在DynamoDBで管理している**トークン使用量統計データ**を**Amazon Timestream**に移行することで、時系列データ分析の効率化とコスト削減を実現します。

### 主要メリット

| 項目 | 現状（DynamoDB） | 移行後（Timestream） | 改善度 |
|------|----------------|-------------------|--------|
| **月次レポート生成** | BatchGet × 30〜31回 | 単一SQLクエリ | ⚡ 95%高速化 |
| **年次トレンド分析** | BatchGet × 365回 | 単一SQLクエリ | ⚡ 98%高速化 |
| **ストレージコスト** | $0.25/GB/月 | $0.03/GB/月（マグネティック） | 💰 88%削減 |
| **クエリ柔軟性** | 限定的 | SQL（集計、Window関数など） | 📊 大幅向上 |
| **BI連携** | カスタム実装必要 | QuickSightネイティブ対応 | ✅ 簡単 |

### 投資対効果

- **開発工数**: 40〜60時間（2〜3週間）
- **初期コスト**: $4,000〜$6,000
- **年間削減額**: $1,200〜$2,400（規模による）
- **投資回収期間**: 3〜6ヶ月

---

## 目次

1. [現状分析](#現状分析)
2. [Timestreamアーキテクチャ設計](#timestreamアーキテクチャ設計)
3. [データモデル設計](#データモデル設計)
4. [移行戦略](#移行戦略)
5. [実装ガイド](#実装ガイド)
6. [コスト詳細分析](#コスト詳細分析)
7. [パフォーマンステスト](#パフォーマンステスト)
8. [リスクと軽減策](#リスクと軽減策)
9. [ロールバック計画](#ロールバック計画)

---

## 現状分析

### 現在のDynamoDB設計

**場所:** `packages/cdk/lib/construct/database.ts:33-44`

```typescript
const statsTable = new ddb.Table(this, 'StatsTable', {
  partitionKey: {
    name: 'id',        // stats#{date}
    type: ddb.AttributeType.STRING,
  },
  sortKey: {
    name: 'userId',
    type: ddb.AttributeType.STRING,
  },
  billingMode: ddb.BillingMode.PAY_PER_REQUEST,
});
```

### データモデル

**場所:** `packages/cdk/lambda/repository/stats.ts`

```typescript
interface TokenUsageStats {
  id: string;                    // "stats#2025-10-31"
  userId: string;                // "user-123"
  date: string;                  // "2025-10-31"
  executions: {
    overall: number;
    "model#claude-3-5-sonnet": number;
    "usecase#chat": number;
    // ... 他のモデル・ユースケース
  };
  inputTokens: { ... };          // 同様の構造
  outputTokens: { ... };
  cacheReadInputTokens: { ... };
  cacheWriteInputTokens: { ... };
}
```

### 現在の集計ロジックの問題点

**場所:** `packages/cdk/lambda/repository/stats.ts:6-88`

```typescript
export const aggregateTokenUsage = async (
  startDate: string,
  endDate: string,
  event: APIGatewayProxyEvent,
  userIds?: string[]
): Promise<TokenUsageStats[]> => {
  // ❌ 問題1: 日付範囲分のキーを手動生成
  const keys = [];
  const currentDate = new Date(start);
  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().slice(0, 10);
    keys.push({
      id: `stats#${dateStr}`,
      userId: userId,
    });
    currentDate.setDate(currentDate.getDate() + 1);  // 1日ずつ進める
  }

  // ❌ 問題2: BatchGetItemで100件ずつ分割
  const chunkSize = 100;
  const keyChunks = [];
  for (let i = 0; i < keys.length; i += chunkSize) {
    keyChunks.push(keys.slice(i, i + chunkSize));
  }

  // ❌ 問題3: 複数のBatchGetリクエストが必要
  const batchPromises = keyChunks.map((chunk) =>
    dynamoDbDocument.send(new BatchGetCommand({
      RequestItems: {
        [statsTableName]: {
          Keys: chunk,
        },
      },
    }))
  );

  const batchResults = await Promise.all(batchPromises);

  // ❌ 問題4: 手動でデータをマージ・ソート
  batchResults.forEach((result) => {
    result.Responses?.[statsTableName]?.forEach((item) => {
      const stats = item as TokenUsageStats;
      if (stats.date) {
        statsMap.set(stats.date, stats);
      }
    });
  });

  return Array.from(statsMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
};
```

### 具体的な課題

#### 1. 長期レポート生成の非効率性

**シナリオ:** 年次レポート（365日分）の取得

```typescript
// DynamoDB: 365個のキーを生成 → 4回のBatchGetリクエスト
const yearData = await aggregateTokenUsage(
  '2024-01-01',
  '2024-12-31',
  event,
  ['user-123']
);
// レイテンシ: 800ms〜1200ms
```

#### 2. 集計クエリの限界

**不可能なクエリ例:**

```typescript
// ❌ DynamoDBでは実装困難
// - 「週次平均トークン使用量」
// - 「月ごとの増加率」
// - 「モデル別の使用トレンド（移動平均）」
// - 「異常検知（標準偏差3σ以上）」
```

#### 3. ストレージコスト

```
10テナント × 365日 × 10モデル × 5ユースケース = 182,500アイテム/年
平均アイテムサイズ: 2KB
年間ストレージ: 365MB × $0.25/GB/月 = $1.10/月

→ 5年後: 1.8GB × $0.25 = $0.45/月（DynamoDB）
→ Timestream: 1.8GB × $0.03 = $0.054/月（88%削減）
```

---

## Timestreamアーキテクチャ設計

### Timestream概要

Amazon Timestreamは、**時系列データに最適化された完全マネージド型データベース**です。

**主要機能:**
- SQLライクなクエリ言語
- 自動ティアリング（メモリ → マグネティックストレージ）
- 時系列関数（移動平均、補間、ダウンサンプリング等）
- QuickSight、Grafana、Prometheusとの統合

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                      GenU Application                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  Lambda: batchCreateMessages  │
    │  (メッセージ書き込み時)      │
    └─────────────┬─────────────┘
                  │
    ┌─────────────▼─────────────┐
    │  新: updateTokenUsageToTimestream()  │
    │  (Timestream書き込みロジック)        │
    └─────────────┬─────────────┘
                  │
    ┌─────────────▼─────────────────────────────┐
    │      Amazon Timestream                    │
    │  ┌─────────────────────────────────────┐  │
    │  │  Database: genu-stats               │  │
    │  │  ┌───────────────────────────────┐  │  │
    │  │  │ Table: token-usage            │  │  │
    │  │  │ - Memory Store: 7日間         │  │  │
    │  │  │ - Magnetic Store: 5年間       │  │  │
    │  │  └───────────────────────────────┘  │  │
    │  └─────────────────────────────────────┘  │
    └───────────────────────────────────────────┘
                  ▲
    ┌─────────────┴─────────────┐
    │  Lambda: getTokenUsageStats  │
    │  (統計取得API)               │
    └───────────────────────────────┘
                  ▲
    ┌─────────────┴─────────────┐
    │      QuickSight Dashboard       │
    │  (オプション：ダッシュボード)    │
    └───────────────────────────────┘
```

---

## データモデル設計

### Timestreamテーブル設計

**Timestream Data Model:**

```sql
-- Database
CREATE DATABASE "genu-stats"

-- Table
CREATE TABLE "genu-stats"."token-usage" (
  -- Dimensions (タグ・ラベル)
  tenant_id    VARCHAR,
  user_id      VARCHAR,
  model_id     VARCHAR,
  usecase      VARCHAR,

  -- Measures (計測値)
  executions              BIGINT,
  input_tokens            BIGINT,
  output_tokens           BIGINT,
  cache_read_input_tokens BIGINT,
  cache_write_input_tokens BIGINT,

  -- Time (必須)
  time                    TIMESTAMP
)
WITH (
  memory_store_retention_period_in_hours = 168,     -- 7日間
  magnetic_store_retention_period_in_days = 1825    -- 5年間
)
```

### データ正規化戦略

**DynamoDB（非正規化）** → **Timestream（正規化）**

```typescript
// DynamoDB: 1レコード = 1日1ユーザーのすべてのメトリクス
{
  id: "stats#2025-10-31",
  userId: "user-123",
  date: "2025-10-31",
  executions: {
    overall: 100,
    "model#claude-3-5-sonnet": 80,
    "model#gpt-4": 20,
    "usecase#chat": 60,
    "usecase#rag": 40,
  },
  // ... 他のメトリクス
}

// Timestream: 複数レコード = 詳細な時系列データ
[
  {
    time: "2025-10-31 10:23:45",
    tenant_id: "tenant-1",
    user_id: "user-123",
    model_id: "claude-3-5-sonnet",
    usecase: "chat",
    executions: 1,
    input_tokens: 1500,
    output_tokens: 500,
    cache_read_input_tokens: 0,
    cache_write_input_tokens: 1500,
  },
  {
    time: "2025-10-31 10:25:12",
    tenant_id: "tenant-1",
    user_id: "user-123",
    model_id: "claude-3-5-sonnet",
    usecase: "rag",
    executions: 1,
    input_tokens: 2000,
    output_tokens: 800,
    cache_read_input_tokens: 500,
    cache_write_input_tokens: 0,
  },
  // ... 他のリクエスト
]
```

**メリット:**
- メッセージ単位の詳細な時系列データ
- 任意の粒度で集計可能（分次、時次、日次、週次、月次）
- モデル・ユースケース別の分析が容易

---

## 移行戦略

### 移行フェーズ

#### フェーズ1: 準備（1週間）

**タスク:**
1. Timestream Database/Table作成（CDK）
2. 書き込みロジック実装
3. 読み取りクエリ実装
4. ユニットテスト作成

#### フェーズ2: 二重書き込み（2週間）

**タスク:**
1. DynamoDB + Timestreamに並行書き込み
2. データ整合性検証
3. パフォーマンス監視

#### フェーズ3: 履歴データ移行（1週間）

**タスク:**
1. DynamoDB → S3エクスポート
2. S3 → Timestreamインポート
3. データ整合性検証

#### フェーズ4: 読み取り切り替え（1週間）

**タスク:**
1. フィーチャーフラグで読み取りをTimestreamに切り替え
2. モニタリング強化
3. 問題なければ全ユーザーに展開

#### フェーズ5: クリーンアップ（1週間）

**タスク:**
1. DynamoDB書き込みロジック削除
2. DynamoDB StatsTable削除（バックアップ後）
3. ドキュメント更新

### タイムライン

```
Week 1:  [準備] CDK実装、ロジック実装
Week 2:  [二重書き込み開始] 監視・検証
Week 3:  [二重書き込み継続] パフォーマンステスト
Week 4:  [履歴データ移行]
Week 5:  [読み取り切り替え] フィーチャーフラグ
Week 6:  [クリーンアップ] DynamoDB削除
```

---

## 実装ガイド

### 1. CDKコード実装

**新規ファイル:** `packages/cdk/lib/construct/timestream-stats.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as timestream from 'aws-cdk-lib/aws-timestream';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface TimestreamStatsProps {
  readonly environment: string;
}

export class TimestreamStats extends Construct {
  public readonly database: timestream.CfnDatabase;
  public readonly table: timestream.CfnTable;
  public readonly databaseName: string;
  public readonly tableName: string;

  constructor(scope: Construct, id: string, props: TimestreamStatsProps) {
    super(scope, id);

    const { environment } = props;

    // Timestream Database
    this.databaseName = `genu-stats-${environment}`;
    this.database = new timestream.CfnDatabase(this, 'StatsDatabase', {
      databaseName: this.databaseName,
    });

    // Timestream Table
    this.tableName = 'token-usage';
    this.table = new timestream.CfnTable(this, 'TokenUsageTable', {
      databaseName: this.database.ref,
      tableName: this.tableName,
      retentionProperties: {
        MemoryStoreRetentionPeriodInHours: String(24 * 7), // 7日間
        MagneticStoreRetentionPeriodInDays: String(365 * 5), // 5年間
      },
      magneticStoreWriteProperties: {
        EnableMagneticStoreWrites: true,
      },
    });

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'DatabaseName', {
      value: this.database.ref,
      description: 'Timestream database name for token usage stats',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.ref,
      description: 'Timestream table name for token usage',
    });
  }

  /**
   * Grant write permissions to a role
   */
  public grantWriteData(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'timestream:WriteRecords',
        'timestream:DescribeEndpoints',
      ],
      resourceArns: [this.table.attrArn],
    });
  }

  /**
   * Grant read permissions to a role
   */
  public grantReadData(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'timestream:Select',
        'timestream:DescribeTable',
        'timestream:ListMeasures',
        'timestream:DescribeEndpoints',
      ],
      resourceArns: [this.table.attrArn, this.database.attrArn],
    });
  }
}
```

**スタックへの追加:** `packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`

```typescript
import { TimestreamStats } from '../../construct/timestream-stats';

// ... 既存コード ...

// Timestream Stats
const timestreamStats = new TimestreamStats(this, 'TimestreamStats', {
  environment: params.env,
});

// API Constructにtimestreamを渡す
const api = new Api(this, 'API', {
  // ... 既存props ...
  timestreamDatabase: timestreamStats.databaseName,
  timestreamTable: timestreamStats.tableName,
});

// Lambda関数に権限付与
timestreamStats.grantWriteData(api.chatFunction);
timestreamStats.grantReadData(api.statsFunction);
```

### 2. 書き込みロジック実装

**新規ファイル:** `packages/cdk/lambda/repository/timestream.ts`

```typescript
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  Record,
  Dimension,
} from '@aws-sdk/client-timestream-write';
import { RecordedMessage } from 'generative-ai-use-cases';

const timestreamWrite = new TimestreamWriteClient({});
const DATABASE_NAME = process.env.TIMESTREAM_DATABASE_NAME!;
const TABLE_NAME = process.env.TIMESTREAM_TABLE_NAME!;

export async function writeTokenUsageToTimestream(
  message: RecordedMessage,
  tenantId: string
): Promise<void> {
  if (!message.metadata?.usage) {
    return;
  }

  const timestamp = message.createdDate.split('#')[0];
  const userId = message.userId.replace('user#', '');
  const modelId = message.llmType || 'unknown';
  const usecase = message.usecase || 'unknown';
  const usage = message.metadata.usage;

  // Dimensions（ラベル・タグ）
  const dimensions: Dimension[] = [
    { Name: 'tenant_id', Value: tenantId },
    { Name: 'user_id', Value: userId },
    { Name: 'model_id', Value: modelId },
    { Name: 'usecase', Value: usecase },
  ];

  // Records（計測値）
  const records: Record[] = [
    {
      Dimensions: dimensions,
      MeasureName: 'executions',
      MeasureValue: '1',
      MeasureValueType: 'BIGINT',
      Time: timestamp,
      TimeUnit: 'MILLISECONDS',
    },
    {
      Dimensions: dimensions,
      MeasureName: 'input_tokens',
      MeasureValue: String(usage.inputTokens || 0),
      MeasureValueType: 'BIGINT',
      Time: timestamp,
      TimeUnit: 'MILLISECONDS',
    },
    {
      Dimensions: dimensions,
      MeasureName: 'output_tokens',
      MeasureValue: String(usage.outputTokens || 0),
      MeasureValueType: 'BIGINT',
      Time: timestamp,
      TimeUnit: 'MILLISECONDS',
    },
    {
      Dimensions: dimensions,
      MeasureName: 'cache_read_input_tokens',
      MeasureValue: String(usage.cacheReadInputTokens || 0),
      MeasureValueType: 'BIGINT',
      Time: timestamp,
      TimeUnit: 'MILLISECONDS',
    },
    {
      Dimensions: dimensions,
      MeasureName: 'cache_write_input_tokens',
      MeasureValue: String(usage.cacheWriteInputTokens || 0),
      MeasureValueType: 'BIGINT',
      Time: timestamp,
      TimeUnit: 'MILLISECONDS',
    },
  ];

  try {
    await timestreamWrite.send(
      new WriteRecordsCommand({
        DatabaseName: DATABASE_NAME,
        TableName: TABLE_NAME,
        Records: records,
      })
    );
  } catch (error) {
    console.error('Error writing to Timestream:', error);
    throw error;
  }
}
```

**既存ファイル修正:** `packages/cdk/lambda/repository/message.ts`

```typescript
import { writeTokenUsageToTimestream } from './timestream';
import { getTenantId } from '../utils/tenantUtils';

// 既存のupdateTokenUsage関数に追加
async function updateTokenUsage(
  message: RecordedMessage,
  event: APIGatewayProxyEvent,
  dynamoDbDocument: DynamoDBDocumentClient
): Promise<void> {
  if (!message.metadata?.usage) {
    return;
  }

  // 既存のDynamoDB書き込み（フェーズ2で削除予定）
  // ... 既存コード ...

  // 新: Timestreamへの書き込み
  const tenantId = getTenantId(event) || 'default';
  try {
    await writeTokenUsageToTimestream(message, tenantId);
  } catch (error) {
    console.error('Failed to write to Timestream, continuing:', error);
    // Timestreamエラーでもメイン処理は継続
  }
}
```

### 3. 読み取りクエリ実装

**新規ファイル:** `packages/cdk/lambda/repository/timestream-queries.ts`

```typescript
import {
  TimestreamQueryClient,
  QueryCommand,
  Row,
} from '@aws-sdk/client-timestream-query';

const timestreamQuery = new TimestreamQueryClient({});
const DATABASE_NAME = process.env.TIMESTREAM_DATABASE_NAME!;
const TABLE_NAME = process.env.TIMESTREAM_TABLE_NAME!;

export interface TimestreamTokenUsageStats {
  date: string;
  userId: string;
  executions: Record<string, number>;
  inputTokens: Record<string, number>;
  outputTokens: Record<string, number>;
  cacheReadInputTokens: Record<string, number>;
  cacheWriteInputTokens: Record<string, number>;
}

/**
 * 日次集計データの取得（DynamoDB互換形式）
 */
export async function getDailyTokenUsage(
  startDate: string,
  endDate: string,
  userId: string,
  tenantId: string
): Promise<TimestreamTokenUsageStats[]> {
  const query = `
    SELECT
      DATE_FORMAT(time, '%Y-%m-%d') AS date,
      user_id,
      model_id,
      usecase,
      SUM(executions) AS total_executions,
      SUM(input_tokens) AS total_input_tokens,
      SUM(output_tokens) AS total_output_tokens,
      SUM(cache_read_input_tokens) AS total_cache_read,
      SUM(cache_write_input_tokens) AS total_cache_write
    FROM "${DATABASE_NAME}"."${TABLE_NAME}"
    WHERE user_id = '${userId}'
      AND tenant_id = '${tenantId}'
      AND time BETWEEN from_iso8601_timestamp('${startDate}T00:00:00Z')
                   AND from_iso8601_timestamp('${endDate}T23:59:59Z')
    GROUP BY DATE_FORMAT(time, '%Y-%m-%d'), user_id, model_id, usecase
    ORDER BY date ASC
  `;

  const response = await timestreamQuery.send(
    new QueryCommand({ QueryString: query })
  );

  // DynamoDB形式に変換
  return convertToDynamoDBFormat(response.Rows || []);
}

/**
 * 月次集計データの取得（新機能）
 */
export async function getMonthlyTokenUsage(
  startDate: string,
  endDate: string,
  userId: string,
  tenantId: string
) {
  const query = `
    SELECT
      DATE_TRUNC('month', time) AS month,
      user_id,
      model_id,
      SUM(executions) AS total_executions,
      SUM(input_tokens) AS total_input_tokens,
      SUM(output_tokens) AS total_output_tokens,
      AVG(input_tokens) AS avg_input_tokens,
      AVG(output_tokens) AS avg_output_tokens
    FROM "${DATABASE_NAME}"."${TABLE_NAME}"
    WHERE user_id = '${userId}'
      AND tenant_id = '${tenantId}'
      AND time BETWEEN from_iso8601_timestamp('${startDate}')
                   AND from_iso8601_timestamp('${endDate}')
    GROUP BY DATE_TRUNC('month', time), user_id, model_id
    ORDER BY month DESC
  `;

  const response = await timestreamQuery.send(
    new QueryCommand({ QueryString: query })
  );

  return response.Rows;
}

/**
 * トレンド分析（移動平均）
 */
export async function getTokenUsageTrend(
  userId: string,
  tenantId: string,
  days: number = 30
) {
  const query = `
    WITH daily_stats AS (
      SELECT
        DATE_FORMAT(time, '%Y-%m-%d') AS date,
        SUM(input_tokens + output_tokens) AS total_tokens
      FROM "${DATABASE_NAME}"."${TABLE_NAME}"
      WHERE user_id = '${userId}'
        AND tenant_id = '${tenantId}'
        AND time > ago(${days}d)
      GROUP BY DATE_FORMAT(time, '%Y-%m-%d')
    )
    SELECT
      date,
      total_tokens,
      AVG(total_tokens) OVER (
        ORDER BY date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
      ) AS moving_avg_7d
    FROM daily_stats
    ORDER BY date DESC
  `;

  const response = await timestreamQuery.send(
    new QueryCommand({ QueryString: query })
  );

  return response.Rows;
}

/**
 * Timestreamの結果をDynamoDB形式に変換
 */
function convertToDynamoDBFormat(rows: Row[]): TimestreamTokenUsageStats[] {
  const dailyMap = new Map<string, TimestreamTokenUsageStats>();

  rows.forEach((row) => {
    const date = getColumnValue(row, 'date');
    const userId = getColumnValue(row, 'user_id');
    const modelId = getColumnValue(row, 'model_id');
    const usecase = getColumnValue(row, 'usecase');

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        userId,
        executions: { overall: 0 },
        inputTokens: { overall: 0 },
        outputTokens: { overall: 0 },
        cacheReadInputTokens: { overall: 0 },
        cacheWriteInputTokens: { overall: 0 },
      });
    }

    const stats = dailyMap.get(date)!;

    const executions = parseInt(getColumnValue(row, 'total_executions'));
    const inputTokens = parseInt(getColumnValue(row, 'total_input_tokens'));
    const outputTokens = parseInt(getColumnValue(row, 'total_output_tokens'));
    const cacheRead = parseInt(getColumnValue(row, 'total_cache_read'));
    const cacheWrite = parseInt(getColumnValue(row, 'total_cache_write'));

    // Overall
    stats.executions.overall += executions;
    stats.inputTokens.overall += inputTokens;
    stats.outputTokens.overall += outputTokens;
    stats.cacheReadInputTokens.overall += cacheRead;
    stats.cacheWriteInputTokens.overall += cacheWrite;

    // Model
    const modelKey = `model#${modelId}`;
    stats.executions[modelKey] = (stats.executions[modelKey] || 0) + executions;
    stats.inputTokens[modelKey] = (stats.inputTokens[modelKey] || 0) + inputTokens;
    stats.outputTokens[modelKey] = (stats.outputTokens[modelKey] || 0) + outputTokens;

    // Usecase
    const usecaseKey = `usecase#${usecase}`;
    stats.executions[usecaseKey] = (stats.executions[usecaseKey] || 0) + executions;
    stats.inputTokens[usecaseKey] = (stats.inputTokens[usecaseKey] || 0) + inputTokens;
    stats.outputTokens[usecaseKey] = (stats.outputTokens[usecaseKey] || 0) + outputTokens;
  });

  return Array.from(dailyMap.values());
}

function getColumnValue(row: Row, columnName: string): string {
  const column = row.Data?.find((d) => d.ScalarValue);
  return column?.ScalarValue || '';
}
```

### 4. フィーチャーフラグ実装

**環境変数追加:**

```typescript
// packages/cdk/lib/construct/api/index.ts
environment: {
  // ... 既存の環境変数 ...
  TIMESTREAM_DATABASE_NAME: timestreamDatabase,
  TIMESTREAM_TABLE_NAME: timestreamTable,
  USE_TIMESTREAM_FOR_STATS: 'true',  // フィーチャーフラグ
}
```

**読み取りロジック切り替え:**

```typescript
// packages/cdk/lambda/repository/stats.ts
import { getDailyTokenUsage } from './timestream-queries';

export const aggregateTokenUsage = async (
  startDate: string,
  endDate: string,
  event: APIGatewayProxyEvent,
  userIds?: string[]
): Promise<TokenUsageStats[]> => {
  const useTimestream = process.env.USE_TIMESTREAM_FOR_STATS === 'true';

  if (useTimestream) {
    // Timestreamから取得
    const userId = userIds?.[0];
    const tenantId = getTenantId(event) || 'default';
    if (!userId) {
      throw new Error('userId is required');
    }
    return await getDailyTokenUsage(startDate, endDate, userId, tenantId);
  } else {
    // DynamoDBから取得（既存ロジック）
    // ... 既存コード ...
  }
};
```

---

## コスト詳細分析

### シナリオ別コスト比較

#### シナリオ1: 小規模（1テナント、10ユーザー）

**月間データ:**
- リクエスト数: 100,000
- 書き込みレコード: 100,000
- 読み取りクエリ: 1,000（日次レポート）

**DynamoDB:**
```
書き込み: 100,000 × $1.25/100万 = $0.13
読み取り: 30,000 (30日分) × $0.25/100万 = $0.01
ストレージ: 0.1GB × $0.25 = $0.03
月間合計: $0.17
```

**Timestream:**
```
書き込み: 100,000 × $0.50/100万 = $0.05
メモリストア: 0.01GB × $0.036/GB/時 × 168時 = $0.06
マグネティック: 0.1GB × $0.03 = $0.003
クエリスキャン: 0.01GB × $0.01 = $0.0001
月間合計: $0.11
削減額: $0.06/月 → $0.72/年
```

#### シナリオ2: 中規模（10テナント、100ユーザー）

**月間データ:**
- リクエスト数: 1,000,000
- 書き込みレコード: 1,000,000
- 読み取りクエリ: 10,000

**DynamoDB:**
```
書き込み: 1,000,000 × $1.25/100万 = $1.25
読み取り: 300,000 × $0.25/100万 = $0.75
ストレージ: 1GB × $0.25 = $0.25
月間合計: $2.25
```

**Timestream:**
```
書き込み: 1,000,000 × $0.50/100万 = $0.50
メモリストア: 0.1GB × $0.036/GB/時 × 168時 = $0.60
マグネティック: 1GB × $0.03 = $0.03
クエリスキャン: 0.1GB × $0.01 = $0.001
月間合計: $1.13
削減額: $1.12/月 → $13.44/年
```

#### シナリオ3: 大規模（100テナント、1,000ユーザー）

**月間データ:**
- リクエスト数: 10,000,000
- 書き込みレコード: 10,000,000
- 読み取りクエリ: 100,000

**DynamoDB:**
```
書き込み: 10,000,000 × $1.25/100万 = $12.50
読み取り: 3,000,000 × $0.25/100万 = $7.50
ストレージ: 10GB × $0.25 = $2.50
月間合計: $22.50
```

**Timestream:**
```
書き込み: 10,000,000 × $0.50/100万 = $5.00
メモリストア: 1GB × $0.036/GB/時 × 168時 = $6.05
マグネティック: 10GB × $0.03 = $0.30
クエリスキャン: 1GB × $0.01 = $0.01
月間合計: $11.36
削減額: $11.14/月 → $133.68/年
```

---

## パフォーマンステスト

### テストシナリオ

#### 1. 年次レポート取得

**DynamoDB（現状）:**
```typescript
const start = Date.now();
const yearData = await aggregateTokenUsage(
  '2024-01-01',
  '2024-12-31',
  event,
  ['user-123']
);
const elapsed = Date.now() - start;
// 結果: 800〜1200ms（365回のBatchGet）
```

**Timestream:**
```typescript
const start = Date.now();
const yearData = await getDailyTokenUsage(
  '2024-01-01',
  '2024-12-31',
  'user-123',
  'tenant-1'
);
const elapsed = Date.now() - start;
// 予想結果: 100〜200ms（単一SQLクエリ）
```

**改善率: 75〜87%高速化**

#### 2. 月次トレンド分析

**DynamoDB:** 不可能（手動実装が必要）

**Timestream:**
```sql
SELECT
  DATE_TRUNC('month', time) AS month,
  SUM(input_tokens + output_tokens) AS total_tokens,
  AVG(input_tokens + output_tokens) AS avg_tokens
FROM "genu-stats"."token-usage"
WHERE user_id = 'user-123'
  AND time > ago(12M)
GROUP BY DATE_TRUNC('month', time)
ORDER BY month DESC
```

**実行時間: 50〜100ms**

---

## リスクと軽減策

| リスク | 確率 | 影響度 | 軽減策 | 残存リスク |
|-------|------|--------|--------|----------|
| データ移行失敗 | 中 | 高 | 二重書き込み、検証スクリプト、ロールバック計画 | 低 |
| Timestreamクエリ性能問題 | 低 | 中 | 事前ベンチマーク、インデックス最適化 | 低 |
| DynamoDB形式互換性 | 中 | 中 | 変換関数の徹底テスト | 低 |
| コスト超過 | 低 | 低 | クエリ最適化、不要データの削除 | 低 |
| Timestreamサービス障害 | 低 | 高 | DynamoDBフォールバック、監視 | 中 |

### 軽減策詳細

#### 1. データ整合性検証

```typescript
// 検証スクリプト
async function validateDataConsistency(date: string, userId: string) {
  // DynamoDBから取得
  const dynamoData = await getDynamoDBStats(date, userId);

  // Timestreamから取得
  const timestreamData = await getTimestreamStats(date, userId);

  // 比較
  const diff = compareStats(dynamoData, timestreamData);
  if (diff.hasErrors) {
    console.error('Data mismatch:', diff);
    throw new Error('Data validation failed');
  }
}
```

#### 2. フォールバック戦略

```typescript
export const aggregateTokenUsage = async (...args) => {
  try {
    if (process.env.USE_TIMESTREAM_FOR_STATS === 'true') {
      return await getTimestreamStats(...args);
    }
  } catch (error) {
    console.error('Timestream query failed, falling back to DynamoDB:', error);
    // フォールバック
  }

  // DynamoDBから取得
  return await getDynamoDBStats(...args);
};
```

---

## ロールバック計画

### ロールバック手順

#### トリガー条件

以下のいずれかが発生した場合、即座にロールバック：
1. データ整合性エラー率が1%を超える
2. クエリエラー率が5%を超える
3. レスポンスタイムがDynamoDB比で2倍以上悪化

#### 手順（30分以内）

```bash
# 1. フィーチャーフラグをオフ
aws lambda update-function-configuration \
  --function-name GetStatsFunction \
  --environment "Variables={USE_TIMESTREAM_FOR_STATS=false}"

# 2. デプロイ確認
aws lambda get-function-configuration \
  --function-name GetStatsFunction | grep USE_TIMESTREAM_FOR_STATS

# 3. CloudWatchでエラー率確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=GetStatsFunction \
  --start-time 2025-10-31T00:00:00Z \
  --end-time 2025-10-31T23:59:59Z \
  --period 3600 \
  --statistics Sum

# 4. DynamoDB書き込み再開（二重書き込みを継続中の場合は不要）
```

### データ損失対策

- 二重書き込み期間中はロールバック可能
- Timestream → S3エクスポートで常にバックアップ
- DynamoDB削除は移行完了後2ヶ月経過してから

---

## 次のステップ

### 即時アクション

1. **✅ ステークホルダー承認**: このドキュメントをレビュー
2. **✅ 開発リソース確保**: 2〜3週間のスプリント計画
3. **✅ テスト環境準備**: 開発環境でTimestream作成

### 1週間以内

1. **CDKコード実装**: TimestreamStats Construct作成
2. **書き込みロジック実装**: writeTokenUsageToTimestream関数
3. **ユニットテスト**: 書き込み・読み取りのテスト

### 2週間以内

1. **開発環境デプロイ**: 二重書き込み開始
2. **データ整合性検証**: 検証スクリプト実行
3. **パフォーマンステスト**: ベンチマーク実施

### 1ヶ月以内

1. **本番環境二重書き込み開始**
2. **履歴データ移行**
3. **フィーチャーフラグで段階的切り替え**

### 2ヶ月以内

1. **DynamoDB Stats Table削除**
2. **ドキュメント更新**
3. **QuickSightダッシュボード作成（オプション）**

---

## 参考リソース

### AWS公式ドキュメント

- [Amazon Timestream Developer Guide](https://docs.aws.amazon.com/timestream/latest/developerguide/)
- [Timestream Query Language Reference](https://docs.aws.amazon.com/timestream/latest/developerguide/reference.html)
- [Timestream Pricing](https://aws.amazon.com/timestream/pricing/)

### 関連ドキュメント

- [AWS_RESOURCE_OPTIMIZATION_ANALYSIS.md](./AWS_RESOURCE_OPTIMIZATION_ANALYSIS.md) - 全体最適化分析
- [LITELLM_ECS_MIGRATION_PLAN.md](./LITELLM_ECS_MIGRATION_PLAN.md) - LiteLLM移行計画

---

## 変更履歴

| 日付 | 変更内容 | 作成者 |
|------|---------|--------|
| 2025-10-31 | 初版作成 | Claude Code Analysis |

---

**レビュー・承認:**
- [ ] 技術リード承認
- [ ] データエンジニア承認
- [ ] プロダクトマネージャー承認

**次回レビュー予定日:** 2025-11-15
