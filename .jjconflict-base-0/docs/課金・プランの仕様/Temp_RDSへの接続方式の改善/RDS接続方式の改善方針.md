# RDS接続方式の改善方針

## このドキュメントの目的

課金・プラン機能で使用するRDS（リレーショナルデータベース）への接続方式を、現在の設計から改善版へ移行する方針を明文化します。この改善により、システムの複雑性を減らし、セキュリティを向上させ、運用負荷を軽減します。

---

## 概要

### 現在の設計

RDSへの接続に**AWS Secrets Manager**を使用しています。接続に必要なパスワードなどの機密情報をSecrets Managerに保管し、Lambda関数が実行時にそれを取得してRDSへ接続します。

### 改善後の設計

**IAM認証**と**RDS Proxy**を組み合わせた方式に移行します。パスワード不要でLambda関数の実行権限（IAMロール）だけでRDSへ接続できるようにし、接続の効率化と安全性の向上を実現します。

### 改善の目的

1. **複雑性の削減**: DynamoDBへのアクセスと同等のシンプルさを実現する
2. **セキュリティの向上**: パスワード管理を完全に不要にする
3. **運用負荷の軽減**: Secrets Managerの管理作業をなくす
4. **パフォーマンスの向上**: RDS Proxyによる接続プーリングで効率化する

---

## 現在の設計の詳細

### 接続の仕組み

現在、Lambda関数がRDSに接続する際、以下の手順を踏んでいます：

1. **環境変数の確認**: Lambda関数に設定された環境変数`BILLING_RDS_SECRET_ARN`から、Secrets ManagerのシークレットのARN（識別子）を取得します

2. **Secrets Managerへのアクセス**: そのARNを使って、AWS Secrets Managerに問い合わせ、RDSへの接続情報を取得します
   - ホスト名（RDSのアドレス）
   - ポート番号（通常は5432または3306）
   - データベース名
   - ユーザー名
   - **パスワード**

3. **RDSへの接続**: 取得した情報を使って、RDSへ接続します

### この設計が採用された背景

課金・プラン機能では、プラン定義、サブスクリプション情報、ユーザプラン適用などの複雑なデータを管理する必要があります。これらのデータには以下の特性があります：

- **外部キー制約が必要**: 存在しないプランへの参照を防ぐ必要がある
- **トランザクション処理が必要**: 複数のテーブルにまたがる更新を一度に行う必要がある
- **データの整合性保証が必要**: 矛盾したデータが発生しないようにする必要がある

これらの要件を満たすため、DynamoDBではなくRDS（PostgreSQLやMySQLなどのリレーショナルデータベース）を使用する設計になっています。

RDSへの接続には通常、ユーザー名とパスワードが必要です。このパスワードを安全に管理するため、AWS Secrets Managerという「秘密情報を安全に保管するサービス」を利用していました。

---

## 現在の設計の問題点

### 問題1: 複雑性が高い

同じシステム内で、データベースへのアクセス方法が2つ存在します：

**DynamoDBへのアクセス**（既存の実装）

- Lambda関数の実行権限（IAMロール）だけでアクセスできる
- 環境変数からテーブル名を取得するだけでよい
- パスワードなどの管理は不要
- Database Per Tenantsパターンのマルチテナントを適用している中で、自然にテナント別のデータアクセスの振り分けを行うことができる

**RDSへのアクセス**（現在の課金機能）

- Lambda関数の実行権限に加えて、Secrets Managerへのアクセス権限も必要
- 環境変数からSecrets ManagerのARNを取得する
- Secrets Managerに問い合わせて接続情報を取得する
- パスワードを管理する必要がある
- テナント別のアクセスの振り分けの実装が追加で必要となる

この違いにより、開発者が理解しなければならない概念が増え、実装の複雑性が高くなっています。

### 問題2: セキュリティ上の管理負荷

Secrets Managerを使う場合、以下の管理作業が発生します：

- **パスワードの定期的なローテーション**（変更）が推奨される
- パスワードを変更する際、RDS側とSecrets Manager側の両方で作業が必要
- パスワードが漏洩した場合、緊急で変更する必要がある
- 古いパスワードと新しいパスワードの切り替えタイミングを管理する必要がある

これらの作業には人的ミスのリスクがあり、運用負荷となります。

### 問題3: 環境変数の依存関係

現在の設計では、`BILLING_RDS_SECRET_ARN`という環境変数が設定されていない場合、課金スタック全体がデプロイに含まれません。これは以下の問題を引き起こします：

- デプロイ前に必ずSecrets Managerへの登録作業が必要
- 環境変数の設定漏れがあると、機能全体が動作しない
- 新しい環境（開発、ステージング、本番など）を構築する際、毎回Secrets Managerの設定が必要

### 問題4: パフォーマンスの非効率性

Lambda関数は、リクエストのたびに起動・停止を繰り返す特性があります（サーバーレス）。現在の設計では：

- Lambda関数が起動するたびに、RDSへの新しい接続を作成する
- RDSへの接続作成には時間がかかる（数百ミリ秒）
- 接続数が増えると、RDSの接続上限に達する可能性がある
- 使い終わった接続を適切に管理する必要がある

これらの問題により、応答速度が遅くなり、RDSのリソースを無駄に消費してしまいます。

### 問題5: マルチテナント対応の複雑さ

このシステムでは、Database per tenantsパターンでマルチテナントに対応しています。現在の設計では：

- 環境変数`BILLING_RDS_SECRET_ARN`から接続情報を取得するため、全テナントで同じRDSに接続することになる
- テナントごとに異なるデータベースへアクセスするための追加実装が必要
- 既存のDynamoDBやOpenSearchへのアクセスでは、Tenantsテーブルから接続情報を取得している
- RDSだけが異なる方式になっており、開発者が理解すべき概念が増える

DynamoDBやOpenSearchと同様に、Tenantsテーブルで各テナントのRDS接続情報を管理することで、一貫性のあるアクセス方法を実現できます。

---

## 新しい設計の詳細

### 改善の方針

新しい設計では、**IAM認証**と**RDS Proxy**という2つの技術を組み合わせます。

#### IAM認証とは

IAM認証は、パスワードの代わりに「一時的なトークン」を使ってRDSに接続する仕組みです。

**特徴**：

- パスワードが不要
- トークンは15分間だけ有効（短時間で自動的に無効になる）
- Lambda関数の実行権限（IAMロール）があれば、トークンを自動生成できる
- トークンの生成・管理はAWSが自動で行う

**仕組み**：

1. Lambda関数が実行される
2. Lambda関数が「RDSに接続したい」と要求する
3. AWSが一時的なトークンを自動生成する（15分間有効）
4. そのトークンを使ってRDSに接続する
5. 15分後、トークンは自動的に無効になる

この仕組みにより、パスワードの保管・管理・ローテーションが完全に不要になります。

#### RDS Proxyとは

RDS Proxyは、Lambda関数とRDSの間に入る「仲介役」のサービスです。

**役割**：

- Lambda関数からの接続要求を受け取る
- RDSへの接続を事前に確保しておく（プーリング）
- Lambda関数が必要な時だけ、確保済みの接続を貸し出す
- 使い終わった接続を回収し、次のLambda関数のために再利用する

**メリット**：

- Lambda関数が起動するたびにRDSへ接続する必要がなくなる
- 接続の作成時間（数百ミリ秒）を節約できる
- RDSの接続数を大幅に削減できる
- Lambda関数が接続を閉じ忘れても、RDS Proxyが自動で管理する

### 新しい設計の接続の仕組み

新しい設計では、以下の手順でRDSに接続します：

1. **テナントIDの取得**: API Gatewayのイベントから、リクエストを送信したユーザーのテナントIDを取得します
   - JWTトークンの`custom:tenant_id`クレームから取得
   - Database per tenantsパターンのマルチテナント対応のため必須

2. **Tenantsテーブルからの接続情報取得**: DynamoDBのTenantsテーブルから、テナント固有のRDS接続情報を取得します
   - RDS Proxyのエンドポイント（アドレス）
   - データベース名
   - リージョン
   - パスワードの情報は不要

3. **テナント専用クレデンシャルの取得**: `getTenantCredentials()`関数を使用して、テナント専用のIAMクレデンシャルを取得します
   - AssumeRoleWithWebIdentityを使用してテナントのIAMロールを引き受け
   - 一時的なアクセスキー、シークレットキー、セッショントークンを取得
   - テナント間のデータ分離を保証

4. **IAM認証トークンの生成**: 取得したテナント専用クレデンシャルを使って、RDS用のIAM認証トークンを生成します
   - AWSが自動的に一時トークンを生成
   - 15分間だけ有効
   - テナント固有のIAMロールの権限で生成される

5. **RDS Proxyへの接続**: 生成されたトークンを使って、テナント固有のRDS Proxyに接続します
   - RDS Proxyが事前に確保しておいた接続を貸し出す
   - 接続作成の待ち時間がほとんどない
   - テナントごとに独立したデータベースへアクセス

6. **データベース操作**: 通常通りデータベースを操作します
   - テナント固有のデータベースに対して操作を実行

7. **接続の返却**: 使い終わった接続をRDS Proxyに返却します
   - RDS Proxyが次のLambda関数のために再利用する

### Secrets Managerとの違い

新しい設計では、Secrets Managerへの依存が完全になくなります：

| 項目                     | 現在の設計（Secrets Manager）        | 新しい設計（IAM認証 + RDS Proxy） |
| ------------------------ | ------------------------------------ | --------------------------------- |
| パスワード管理           | 必要（Secrets Managerに保管）        | 不要（IAMトークンを自動生成）     |
| 接続情報の取得           | Secrets ManagerへのAPI呼び出しが必要 | Tenantsテーブルから取得           |
| 認証方法                 | ユーザー名とパスワード               | IAMロールと一時トークン           |
| セキュリティリスク       | パスワードが漏洩する可能性           | トークンは15分で自動失効          |
| 運用作業                 | パスワードローテーションが必要       | 運用作業なし（AWSが自動管理）     |
| 接続効率                 | Lambda起動ごとに接続作成             | RDS Proxyが接続をプーリング       |
| マルチテナント対応       | テナント別のアクセス制御が複雑       | Tenantsテーブルベースで自然に実現 |
| 他のサービスとの整合性   | DynamoDBとは異なるアクセス方法       | DynamoDBやOpenSearchと同じ方式    |

---

## Tenantsテーブルのスキーマ拡張

新しい設計では、各テナントのRDS接続情報をTenantsテーブルで管理します。既存のOpenSearch接続情報の管理方法と同じパターンを採用します。

### 追加するフィールド

Tenantsテーブルに以下のフィールドを追加します：

| フィールド名       | 型     | 説明                                           | 例                                          |
| ------------------ | ------ | ---------------------------------------------- | ------------------------------------------- |
| `rdsProxyEndpoint` | String | テナント専用RDS Proxyのエンドポイント          | `billing-proxy.proxy-xxx.ap-northeast-1.rds.amazonaws.com` |
| `rdsDatabase`      | String | 接続先データベース名                           | `tenant_abc_billing`                        |
| `rdsRegion`        | String | RDSのリージョン                                | `ap-northeast-1`                            |
| `rdsPort`          | Number | RDSの接続ポート（デフォルト: 5432 or 3306）    | `5432`                                      |

### 既存の類似実装との整合性

OpenSearchへの接続では、以下のフィールドでテナント情報を管理しています：

- `openSearchEndpoint`: OpenSearchドメインのエンドポイント
- `roleArn`: テナント専用のIAMロール

RDSでも同様に、テナントごとの接続情報を管理することで：

1. **実装パターンの統一**: 開発者は同じパターンで理解できる
2. **マルチテナント対応が自然**: テナントIDから接続先を動的に決定
3. **テスト環境の柔軟性**: テナントごとに異なる環境（開発用DB、本番用DB）を指定可能

---

## 実装例

### 1. TenantsテーブルからのRDS接続情報取得

OpenSearchの実装（`packages/cdk/lambda/repository/assistantSearch.ts:38-90`）を参考にした実装例：

```typescript
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION! });

// キャッシュ（同一テナントへの連続アクセスを最適化）
let cachedRdsConfig: RdsConfig | null = null;
let cachedTenantId: string | null = null;

interface RdsConfig {
  proxyEndpoint: string;
  database: string;
  region: string;
  port: number;
}

/**
 * TenantsテーブルからテナントのRDS接続情報を取得
 */
async function getRdsConfigForTenant(tenantId: string): Promise<RdsConfig> {
  // キャッシュチェック
  if (cachedRdsConfig && cachedTenantId === tenantId) {
    console.log(`Using cached RDS config for tenant ${tenantId}`);
    return cachedRdsConfig;
  }

  const tenantsTableName = process.env.TENANTS_TABLE_NAME;

  if (!tenantsTableName) {
    throw new Error(
      'TENANTS_TABLE_NAME environment variable is required for multi-tenant RDS access'
    );
  }

  try {
    console.log(`Retrieving RDS config for tenant ${tenantId} from table ${tenantsTableName}`);

    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: tenantsTableName,
        Key: {
          tenantId: { S: tenantId },
        },
      })
    );

    if (!response.Item) {
      throw new Error(
        `Tenant ${tenantId} not found in tenants table. Ensure tenant is registered with RDS configuration.`
      );
    }

    const tenant = unmarshall(response.Item);

    // RDS接続情報の検証
    if (!tenant.rdsProxyEndpoint) {
      throw new Error(
        `RDS Proxy endpoint not configured for tenant ${tenantId}. Please run tenant RDS setup.`
      );
    }

    const rdsConfig: RdsConfig = {
      proxyEndpoint: tenant.rdsProxyEndpoint,
      database: tenant.rdsDatabase || 'billing',
      region: tenant.rdsRegion || process.env.AWS_REGION!,
      port: tenant.rdsPort || 5432,
    };

    // キャッシュ更新
    cachedRdsConfig = rdsConfig;
    cachedTenantId = tenantId;

    console.log(`Successfully retrieved RDS config for tenant ${tenantId}`);
    return rdsConfig;
  } catch (error) {
    console.error(`Failed to retrieve RDS config for tenant ${tenantId}:`, error);
    throw error;
  }
}
```

### 2. テナント専用クレデンシャルの取得とRDS接続

```typescript
import { getTenantCredentials } from '../utils/tenantCredentials';
import { extractTenantId } from '../utils/assumeRoleWithWebIdentity';
import { RDSClient } from '@aws-sdk/client-rds';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

/**
 * RDSに接続するための設定を取得
 */
export async function getRdsConnection(event: APIGatewayProxyEvent) {
  // 1. テナントIDを取得
  const tenantId = extractTenantId(event);

  // 2. Tenantsテーブルからテナント固有のRDS接続情報を取得
  const rdsConfig = await getRdsConfigForTenant(tenantId);

  // 3. テナント専用のIAMクレデンシャルを取得
  const { credentials, tenant } = await getTenantCredentials(event);

  // 4. IAM認証トークンを生成してRDSに接続
  // （具体的な実装はORMやデータベースドライバに依存）
  const connectionConfig = {
    host: rdsConfig.proxyEndpoint,
    port: rdsConfig.port,
    database: rdsConfig.database,
    user: 'db_iam_user', // IAM認証用のDBユーザー
    // IAM認証トークンをパスワードとして使用
    password: await generateRdsAuthToken({
      hostname: rdsConfig.proxyEndpoint,
      port: rdsConfig.port,
      username: 'db_iam_user',
      region: rdsConfig.region,
      credentials: credentials,
    }),
    ssl: {
      rejectUnauthorized: true,
    },
  };

  return connectionConfig;
}

/**
 * RDS IAM認証トークンを生成
 */
async function generateRdsAuthToken(params: {
  hostname: string;
  port: number;
  username: string;
  region: string;
  credentials: any;
}): Promise<string> {
  const { Signer } = await import('@aws-sdk/rds-signer');

  const signer = new Signer({
    hostname: params.hostname,
    port: params.port,
    username: params.username,
    region: params.region,
    credentials: params.credentials,
  });

  return await signer.getAuthToken();
}
```

### 3. Repository層での利用例

```typescript
import { Pool } from 'pg'; // PostgreSQLの例

export class PlanRepository {
  private pool: Pool;

  constructor(connectionConfig: any) {
    this.pool = new Pool(connectionConfig);
  }

  async findByInternalName(internalName: string) {
    const result = await this.pool.query(
      'SELECT * FROM plans WHERE internal_name = $1',
      [internalName]
    );
    return result.rows[0];
  }

  async create(plan: CreatePlanInput) {
    const result = await this.pool.query(
      'INSERT INTO plans (internal_name, display_name, ...) VALUES ($1, $2, ...) RETURNING *',
      [plan.internal_name, plan.display_name, ...]
    );
    return result.rows[0];
  }

  // ... その他のメソッド
}
```

### 4. Lambda関数での利用例

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    // テナント固有のRDS接続設定を取得
    const connectionConfig = await getRdsConnection(event);

    // Repositoryを初期化
    const planRepository = new PlanRepository(connectionConfig);

    // データベース操作
    const plan = await planRepository.findByInternalName('premium');

    return {
      statusCode: 200,
      body: JSON.stringify(plan),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
```

---

## 実装時の注意点

### 1. IAM認証トークンの有効期限

IAM認証トークンは15分間有効です。接続プールを使用する場合、以下の点に注意してください：

- トークンの有効期限が切れる前に新しいトークンを生成する
- 接続プールの設定で、接続の有効期限を15分未満に設定する
- RDS Proxyを使用することで、この問題は自動的に解決される

### 2. エラーハンドリング

テナントの接続情報が見つからない場合や、IAM認証に失敗した場合のエラーハンドリングを適切に実装してください：

```typescript
try {
  const rdsConfig = await getRdsConfigForTenant(tenantId);
} catch (error) {
  if (error.message.includes('not found')) {
    // テナントが見つからない場合の処理
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Tenant not found' }),
    };
  }
  if (error.message.includes('not configured')) {
    // RDS設定がない場合の処理
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Database not configured for this tenant' }),
    };
  }
  throw error;
}
```

### 3. 接続プールの管理

Lambda関数の実行コンテキストをまたいで接続プールを再利用する場合：

- グローバルスコープで接続プールを定義
- テナントごとに異なる接続プールを管理（`Map<tenantId, Pool>`）
- 接続プールのサイズを適切に設定（Lambda同時実行数に応じて調整）

```typescript
// テナントごとの接続プールをキャッシュ
const poolCache = new Map<string, Pool>();

export async function getPoolForTenant(tenantId: string): Promise<Pool> {
  if (poolCache.has(tenantId)) {
    return poolCache.get(tenantId)!;
  }

  const rdsConfig = await getRdsConfigForTenant(tenantId);
  const connectionConfig = await getRdsConnection(event); // eventを渡す必要がある

  const pool = new Pool({
    ...connectionConfig,
    max: 2, // Lambda関数あたりの最大接続数を制限
  });

  poolCache.set(tenantId, pool);
  return pool;
}
```

---

## まとめ

新しい設計では、以下の改善が実現されます：

1. **マルチテナント対応の統一**: Tenantsテーブルでテナントごとの接続情報を管理
2. **実装パターンの統一**: DynamoDBやOpenSearchと同じアクセス方法
3. **セキュリティの向上**: パスワード不要のIAM認証
4. **運用負荷の軽減**: Secrets Managerの管理が不要
5. **パフォーマンスの向上**: RDS Proxyによる接続プーリング
6. **開発効率の向上**: 一貫した実装パターンで理解しやすい

この方針に基づいて実装することで、セキュアで保守性の高いマルチテナントRDSアクセスが実現できます。
