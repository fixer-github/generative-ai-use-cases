# OpenFGA 認可システム - 完全ガイド

## 目次

1. [認可とは何か - 基本概念](#1-認可とは何か---基本概念)
2. [なぜOpenFGAを使うのか](#2-なぜopenfgaを使うのか)
3. [システムアーキテクチャ概要](#3-システムアーキテクチャ概要)
4. [OpenFGAの仕組み - 詳細解説](#4-openfgaの仕組み---詳細解説)
5. [実装されたインフラストラクチャ](#5-実装されたインフラストラクチャ)
6. [認可チェックの流れ](#6-認可チェックの流れ)
7. [トラブルシューティング](#7-トラブルシューティング)

---

## 1. 認可とは何か - 基本概念

### 1.1 認証 vs 認可

まず、よく混同される2つの概念を整理します：

#### 認証（Authentication）
- **「あなたは誰ですか？」** という質問に答える
- ユーザーが本人であることを証明するプロセス
- 例：パスワード入力、多要素認証（MFA）
- このシステムでは **Cognito** が担当

#### 認可（Authorization）
- **「あなたは何ができますか？」** という質問に答える
- 認証されたユーザーが特定の操作を実行できるかを判断
- 例：「このユーザーはGPT-4を使えるか？」「画像生成機能にアクセスできるか？」
- このシステムでは **OpenFGA** が担当

### 1.2 なぜ認可が必要か

マルチテナントシステムでは、以下の要件があります：

1. **テナントごとの異なる権限**
   - テナントAは全機能利用可能
   - テナントBは画像生成のみ利用可能
   - テナントCはClaude-3のみ利用可能

2. **ユーザーごとの細かい制御**
   - 管理者はすべての機能を使える
   - 一般ユーザーは基本機能のみ
   - ゲストユーザーは閲覧のみ

3. **柔軟な権限管理**
   - グループ単位での権限付与
   - 期間限定の権限付与
   - 動的な権限変更

---

## 2. なぜOpenFGAを使うのか

### 2.1 OpenFGAとは

OpenFGAは、Googleが開発した[Zanzibar論文](https://research.google/pubs/pub48190/)をベースにした、オープンソースの認可システムです。

**特徴：**
- 関係ベースのアクセス制御（ReBAC: Relationship-Based Access Control）
- 高速な権限チェック（ミリ秒単位）
- 複雑な権限構造を表現可能
- グラフベースの権限継承

### 2.2 他の方式との比較

| 方式 | 説明 | メリット | デメリット |
|------|------|----------|------------|
| **RBAC**<br>(Role-Based) | ロール（役割）に基づく制御<br>例：admin, user, guest | シンプル、理解しやすい | 柔軟性が低い、細かい制御が困難 |
| **ABAC**<br>(Attribute-Based) | 属性に基づく制御<br>例：部署、役職、年齢 | 非常に柔軟 | 複雑、パフォーマンスが課題 |
| **ReBAC**<br>(Relationship-Based) | 関係性に基づく制御<br>例：所有者、メンバー、閲覧者 | 柔軟かつ高速、自然な表現 | 学習コストがある |

**このシステムはReBACを採用** → 柔軟性とパフォーマンスのバランスが最適

---

## 3. システムアーキテクチャ概要

### 3.1 全体像

```
┌─────────────────────────────────────────────────────────────┐
│                     共通アカウント                            │
│  ┌──────────────┐                                           │
│  │ Lambda関数   │  1. リクエスト受信                         │
│  │ (predict.ts) │  2. ユーザー認証確認                       │
│  └──────┬───────┘  3. テナント情報取得                       │
│         │          4. AssumeRole でテナントロール取得         │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │ DynamoDB     │                                           │
│  │ Tenants Table│ ← テナント情報（OpenFGAエンドポイント含む）│
│  └──────────────┘                                           │
└───────────────────┼─────────────────────────────────────────┘
                    │ AssumeRole (クロスアカウントアクセス)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  テナント専用アカウント                       │
│                                                               │
│  ┌──────────────────────────────────────────┐               │
│  │ Lambda (共通) が以下にアクセス:            │               │
│  │                                          │               │
│  │  5. API Gateway に SigV4 署名付きリクエスト │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐               │
│  │        API Gateway (IAM 認証)            │               │
│  │        + VPC Link                        │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐               │
│  │    Network Load Balancer (Internal)      │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐               │
│  │    ECS Fargate (OpenFGA Container)       │               │
│  │                                          │               │
│  │  6. 権限チェック実行                      │               │
│  │     user:john が llm:claude-3 に         │               │
│  │     accessor 権限を持つか？               │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                            │
│                 ▼                                            │
│  ┌──────────────────────────────────────────┐               │
│  │    RDS PostgreSQL                        │               │
│  │    (認可データ保存)                       │               │
│  └──────────────────────────────────────────┘               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 データの流れ

1. **ユーザーがLLMを使おうとする**
   - フロントエンドから `/predict` API を呼び出し
   - JWTトークンで認証済み

2. **共通Lambda関数が認可チェックを開始**
   - リクエストからテナントIDとユーザーIDを抽出
   - DynamoDBからテナント情報（OpenFGAエンドポイント）を取得
   - テナントロールを AssumeRole で取得

3. **テナントのOpenFGAに問い合わせ**
   - SigV4署名を使ってAPI Gatewayにリクエスト
   - OpenFGAが権限を判定（数ミリ秒）

4. **結果に応じて処理**
   - 権限あり → LLM API呼び出しを実行
   - 権限なし → 403 Forbidden を返す

---

## 4. OpenFGAの仕組み - 詳細解説

### 4.1 認可スキーマ（Authorization Model）

OpenFGAでは、**型（Type）** と **関係（Relation）** で権限を定義します。

#### 実装されたスキーマ

```
type user
  (ユーザー自体。権限の主体)

type group
  relations
    define member: [user, group]
  (グループ。ユーザーやグループを含められる)

type entitlement
  relations
    define holder: [user, group]
  (エンタイトルメント＝権利。ユーザーやグループに付与される)

type llm
  relations
    define via_access: [entitlement]
    define accessor: [user, group] or holder from via_access
  (LLMモデル。直接 or エンタイトルメント経由でアクセス可能)

type feature
  relations
    define via_enable: [entitlement]
    define enabled_user: [user, group] or holder from via_enable
  (機能。直接 or エンタイトルメント経由で有効化)
```

### 4.2 具体例で理解する

#### 例1: ユーザーに直接権限を付与

**シナリオ:** ユーザー `alice` に `claude-3-sonnet` の使用権限を与える

**OpenFGAのデータ（Tuple）:**
```
user:alice, accessor, llm:claude-3-sonnet
```

**意味:**
- alice は claude-3-sonnet に対して accessor（アクセス権）を持つ

**チェック:**
```
user:alice が llm:claude-3-sonnet に accessor 権限を持つか？
→ YES
```

#### 例2: グループを使った権限付与

**シナリオ:**
1. `premium-users` グループを作成
2. `alice` と `bob` をグループに追加
3. グループに `claude-3-sonnet` の権限を付与

**OpenFGAのデータ（Tuples）:**
```
user:alice, member, group:premium-users
user:bob, member, group:premium-users
group:premium-users, accessor, llm:claude-3-sonnet
```

**チェック:**
```
user:alice が llm:claude-3-sonnet に accessor 権限を持つか？
→ YES (group:premium-users 経由で権限を持つ)

user:bob が llm:claude-3-sonnet に accessor 権限を持つか？
→ YES (同じくグループ経由)

user:charlie が llm:claude-3-sonnet に accessor 権限を持つか？
→ NO (グループのメンバーではない)
```

#### 例3: エンタイトルメントを使った権限管理（推奨）

**シナリオ:**
1. `basic-plan` エンタイトルメントを作成
2. エンタイトルメントに複数のLLMと機能を紐付け
3. ユーザーにエンタイトルメントを付与

**OpenFGAのデータ（Tuples）:**
```
# エンタイトルメントとユーザーの関係
user:alice, holder, entitlement:basic-plan

# エンタイトルメントとLLMの関係
entitlement:basic-plan, via_access, llm:claude-3-haiku
entitlement:basic-plan, via_access, llm:claude-3-sonnet

# エンタイトルメントと機能の関係
entitlement:basic-plan, via_enable, feature:chat
entitlement:basic-plan, via_enable, feature:image-generation
```

**チェック:**
```
user:alice が llm:claude-3-haiku に accessor 権限を持つか？
→ YES
   1. alice は entitlement:basic-plan の holder
   2. basic-plan は llm:claude-3-haiku への via_access を持つ
   3. スキーマ定義: accessor = [user, group] or holder from via_access
   4. よって、alice は accessor 権限を持つ

user:alice が llm:claude-3-opus に accessor 権限を持つか？
→ NO
   (basic-plan は claude-3-opus への via_access を持っていない)

user:alice が feature:video-generation を使えるか？
→ NO
   (basic-plan は video-generation への via_enable を持っていない)
```

**エンタイトルメントの利点:**
- プランやパッケージの概念を表現できる
- 複数の権限をまとめて管理
- ユーザーのプラン変更が1つのTuple変更で済む

---

## 5. 実装されたインフラストラクチャ

### 5.1 テナント専用リソース

各テナントは以下のリソースを持ちます：

#### 5.1.1 RDS PostgreSQL
- **用途:** OpenFGAのデータストア
- **インスタンスタイプ:** t4g.micro
- **ストレージ:** 20GB（最大100GBまで自動拡張）
- **配置:** VPCのプライベートサブネット
- **バックアップ:** 本番環境は7日間保持

#### 5.1.2 ECS Fargate
- **イメージ:** openfga/openfga:v1.8.0
- **リソース:** CPU 256, メモリ 512MB
- **レプリカ数:** 1（本番環境では増やすことを推奨）
- **ヘルスチェック:** /healthz エンドポイント

#### 5.1.3 Network Load Balancer (NLB)
- **タイプ:** 内部向け（Internal）
- **ターゲット:** ECS Fargateタスク
- **ヘルスチェック:** HTTP /healthz

#### 5.1.4 API Gateway (REST API)
- **認証:** AWS_IAM
- **統合:** VPC Link経由でNLBに接続
- **リソースポリシー:** 共通アカウントのLambdaロールのみ許可

### 5.2 セキュリティ設計

```
┌─────────────────────────────────────────────────────────┐
│ セキュリティ層                                            │
├─────────────────────────────────────────────────────────┤
│ 1. Lambda関数の認証                                      │
│    - Cognito JWTトークン検証                             │
│    - テナントIDの検証                                     │
├─────────────────────────────────────────────────────────┤
│ 2. クロスアカウントアクセス制御                           │
│    - AssumeRoleによる一時クレデンシャル                  │
│    - テナントごとに分離されたIAMロール                    │
├─────────────────────────────────────────────────────────┤
│ 3. API Gateway認証                                       │
│    - SigV4署名検証                                       │
│    - IAMベース認証                                       │
├─────────────────────────────────────────────────────────┤
│ 4. ネットワーク分離                                       │
│    - VPC内のプライベート通信                              │
│    - Security Group による通信制限                        │
├─────────────────────────────────────────────────────────┤
│ 5. データベース暗号化                                     │
│    - RDS暗号化（保存時）                                 │
│    - TLS通信（転送時）                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 認可チェックの流れ

### 6.1 Lambda関数での実装例

`packages/cdk/lambda/predict.ts` の実装：

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  // 1. リクエストからユーザー情報を取得
  const userId = event.requestContext.authorizer!.claims['cognito:username'];
  const req: PredictRequest = JSON.parse(event.body!);
  const model = req.model || defaultModel;

  // 2. テナントクレデンシャルを取得（AssumeRole実行）
  const { credentials } = await getTenantCredentials(event);

  // 3. OpenFGAクライアントを作成
  const openFgaClient = await createOpenFgaClient(event, credentials);

  // 4. LLMモデルへのアクセス権をチェック
  const hasAccess = await checkLlmAccess(
    openFgaClient,
    userId,
    model.modelId
  );

  // 5. 権限がない場合は403を返す
  if (!hasAccess) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        message: `You do not have permission to use the model: ${model.modelId}`,
      }),
    };
  }

  // 6. 権限がある場合のみLLM APIを呼び出し
  const response = await api[model.type].invoke(model, req.messages, req.id);
  return { statusCode: 200, body: JSON.stringify(response) };
};
```

### 6.2 パフォーマンス最適化

#### キャッシング
```typescript
// openFgaClient.ts 内
const authCache = new Map<string, { result: boolean; timestamp: number }>();
const DEFAULT_CACHE_TTL = 60000; // 1分間キャッシュ
```

**キャッシュキー:** `{tenantId}:{userId}:{relation}:{objectType}:{objectId}`

**効果:**
- 同じユーザーの連続リクエスト → キャッシュから即座に応答
- OpenFGA APIへの負荷軽減
- レスポンスタイム短縮（数ミリ秒 → マイクロ秒）

#### 後方互換性
```typescript
if (!openFgaClient) {
  // OpenFGAが設定されていない場合は許可（既存動作を維持）
  console.warn('OpenFGA not configured. Allowing access by default.');
  return true;
}
```

---

## 7. トラブルシューティング

### 7.1 よくある問題と解決方法

#### 問題1: すべてのリクエストが403エラーになる

**原因:**
- OpenFGAに権限データが登録されていない
- スキーマ初期化が失敗している

**確認方法:**
```bash
# CloudWatch Logs でエラーを確認
aws logs tail /aws/lambda/{environment}-{tenantId}-openfga-schema-init --follow

# ECSタスクログを確認
aws logs tail /aws/ecs/{environment}-{tenantId}-openfga --follow
```

**解決方法:**
- [権限付与ガイド](./AUTHORIZATION_GRANTS.md) を参照して権限を設定

#### 問題2: OpenFGA APIへの接続がタイムアウトする

**原因:**
- ECS Fargateタスクが起動していない
- NLBのヘルスチェックが失敗している
- RDSへの接続が確立できていない

**確認方法:**
```bash
# ECSタスクの状態を確認
aws ecs describe-tasks \
  --cluster {environment}-{tenantId}-openfga \
  --tasks $(aws ecs list-tasks \
    --cluster {environment}-{tenantId}-openfga \
    --query 'taskArns[0]' --output text)

# ヘルスチェックを確認
aws elbv2 describe-target-health \
  --target-group-arn {target-group-arn}
```

**解決方法:**
1. ECSタスクを再起動
2. RDSのセキュリティグループを確認
3. データベース接続情報を確認

#### 問題3: 権限を付与したのに反映されない

**原因:**
- キャッシュが残っている
- 間違ったTupleを登録した

**解決方法:**
```typescript
// キャッシュをクリア（開発環境のみ推奨）
import { clearAuthCache } from './utils/openFgaClient';
clearAuthCache();
```

### 7.2 モニタリング

#### CloudWatch メトリクス

- **ECS CPU/メモリ使用率**
- **RDS 接続数**
- **API Gateway リクエスト数とレイテンシー**
- **Lambda エラー率**

#### ログの確認場所

```bash
# Lambda（認可チェック）のログ
/aws/lambda/{function-name}

# OpenFGA（ECS）のログ
/aws/ecs/{environment}-{tenantId}-openfga

# API Gateway のログ
/aws/api-gateway/{api-id}/prod
```

---

## 次のステップ

認可システムの仕組みを理解したら、次は実際に権限を付与する方法を学びましょう：

👉 **[権限付与ガイド](./AUTHORIZATION_GRANTS.md)** へ進む

---

## 用語集

| 用語 | 説明 |
|------|------|
| **Tuple** | OpenFGAのデータ単位。`(user, relation, object)` の3つ組 |
| **Relation** | 主体（user）と客体（object）の関係。例: accessor, member, holder |
| **Type** | オブジェクトの種類。例: user, group, llm, feature |
| **Store** | OpenFGAのデータベース。テナントごとに1つ |
| **Authorization Model** | 認可スキーマ。TypeとRelationの定義 |
| **Check** | 権限チェック。特定のTupleが存在するかを確認 |
| **Write** | Tupleの書き込み（権限の付与） |
| **SigV4** | AWS Signature Version 4。API Gatewayの認証に使用 |
| **AssumeRole** | 別のIAMロールを一時的に引き受ける |
| **VPC Link** | API GatewayとVPC内リソースを接続 |
