# 権限付与ガイド - OpenFGA実践編

## 目次

1. [権限付与の基本](#1-権限付与の基本)
2. [準備: OpenFGA APIへの接続](#2-準備-openfga-apiへの接続)
3. [パターン別権限付与](#3-パターン別権限付与)
4. [実践例とユースケース](#4-実践例とユースケース)
5. [権限の確認と削除](#5-権限の確認と削除)
6. [ベストプラクティス](#6-ベストプラクティス)

---

## 1. 権限付与の基本

### 1.1 権限付与の3ステップ

```
1. 何を（Object）    → llm:claude-3-sonnet, feature:image-generation
2. 誰に（Subject）   → user:alice, group:premium-users
3. どんな関係で（Relation） → accessor, enabled_user, member
```

### 1.2 OpenFGA APIの基本操作

OpenFGAには主に3つの操作があります：

| 操作 | 説明 | HTTPメソッド | エンドポイント |
|------|------|--------------|----------------|
| **Write** | Tuple（権限データ）を書き込む | POST | `/stores/{store_id}/write` |
| **Check** | 権限があるか確認する | POST | `/stores/{store_id}/check` |
| **Read** | Tupleを読み取る | POST | `/stores/{store_id}/read` |

---

## 2. 準備: OpenFGA APIへの接続

### 2.1 必要な情報

権限を付与するには、以下の情報が必要です：

```bash
# テナント情報
TENANT_ID="tenant001"
TENANT_ACCOUNT_ID="123456789012"
TENANT_REGION="ap-northeast-1"

# OpenFGA API Gateway エンドポイント（CloudFormation Output から取得）
OPENFGA_ENDPOINT="https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod"

# テナントロールARN（CloudFormation Output から取得）
TENANT_ROLE_ARN="arn:aws:iam::123456789012:role/TenantRole-tenant001"
```

### 2.2 AWS CLIでの接続準備

#### ステップ1: テナントロールを引き受ける

```bash
# 一時クレデンシャルを取得
aws sts assume-role \
  --role-arn "${TENANT_ROLE_ARN}" \
  --role-session-name "openfga-admin-session" \
  --duration-seconds 3600 \
  --output json > /tmp/credentials.json

# 環境変数に設定
export AWS_ACCESS_KEY_ID=$(cat /tmp/credentials.json | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(cat /tmp/credentials.json | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(cat /tmp/credentials.json | jq -r '.Credentials.SessionToken')
```

#### ステップ2: SigV4署名付きリクエストを送信

AWS CLIには `aws execute-api invoke` コマンドがありますが、RESTful APIには使いにくいため、`awscurl` を使用します。

```bash
# awscurl をインストール（初回のみ）
pip install awscurl

# テスト: ヘルスチェック
awscurl --service execute-api --region ${TENANT_REGION} \
  "${OPENFGA_ENDPOINT}/healthz"
```

---

## 3. パターン別権限付与

### パターン1: ユーザーに直接LLM権限を付与

**シナリオ:** ユーザー `john@example.com` に `claude-3-sonnet` の使用権限を与える

#### JSON リクエスト

```json
{
  "writes": [
    {
      "user": "user:john@example.com",
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
    }
  ]
}
```

#### cURLコマンド

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "user:john@example.com",
        "relation": "accessor",
        "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### 権限確認

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "user": "user:john@example.com",
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
    }
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/check"
```

**レスポンス:**
```json
{
  "allowed": true
}
```

---

### パターン2: グループ経由で権限を付与

**シナリオ:**
1. `premium-users` グループを作成
2. ユーザー `alice` と `bob` をグループに追加
3. グループに複数のLLMモデルへのアクセス権を付与

#### ステップ1: ユーザーをグループに追加

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "user:alice@example.com",
        "relation": "member",
        "object": "group:premium-users"
      },
      {
        "user": "user:bob@example.com",
        "relation": "member",
        "object": "group:premium-users"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### ステップ2: グループにLLM権限を付与

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "group:premium-users",
        "relation": "accessor",
        "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
      },
      {
        "user": "group:premium-users",
        "relation": "accessor",
        "object": "llm:anthropic.claude-3-opus-20240229-v1:0"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### 権限確認

```bash
# alice が claude-3-sonnet を使えるか確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "user": "user:alice@example.com",
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
    }
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/check"
```

**レスポンス:**
```json
{
  "allowed": true
}
```

OpenFGAは自動的に以下のように推論します：
```
alice → member of premium-users → premium-users has accessor to claude-3-sonnet
→ alice has accessor to claude-3-sonnet
```

---

### パターン3: エンタイトルメント経由で権限を付与（推奨）

**シナリオ:**
1. `basic-plan` エンタイトルメントを作成
2. エンタイトルメントにLLMと機能を紐付け
3. ユーザーにエンタイトルメントを付与

#### ステップ1: ユーザーをエンタイトルメントの holder に設定

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "user:alice@example.com",
        "relation": "holder",
        "object": "entitlement:basic-plan"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### ステップ2: エンタイトルメントにLLMを紐付け

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "entitlement:basic-plan",
        "relation": "via_access",
        "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"
      },
      {
        "user": "entitlement:basic-plan",
        "relation": "via_access",
        "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### ステップ3: エンタイトルメントに機能を紐付け

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {
        "user": "entitlement:basic-plan",
        "relation": "via_enable",
        "object": "feature:chat"
      },
      {
        "user": "entitlement:basic-plan",
        "relation": "via_enable",
        "object": "feature:image-generation"
      }
    ]
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### 権限確認

```bash
# alice が claude-3-haiku を使えるか確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "user": "user:alice@example.com",
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"
    }
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/check"

# alice が image-generation を使えるか確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "user": "user:alice@example.com",
      "relation": "enabled_user",
      "object": "feature:image-generation"
    }
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/check"
```

**推論の流れ:**
```
1. alice は entitlement:basic-plan の holder
2. basic-plan は llm:claude-3-haiku への via_access を持つ
3. スキーマ定義: accessor = [user, group] or holder from via_access
4. よって、alice は claude-3-haiku への accessor 権限を持つ
```

---

## 4. 実践例とユースケース

### ユースケース1: 新規ユーザーのオンボーディング

**要件:** 新しいユーザー `carol@example.com` に基本的な権限を付与

#### 一括付与スクリプト

```bash
#!/bin/bash

USER_EMAIL="carol@example.com"
ENTITLEMENT="basic-plan"

# エンタイトルメントを付与
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"writes\": [
      {
        \"user\": \"user:${USER_EMAIL}\",
        \"relation\": \"holder\",
        \"object\": \"entitlement:${ENTITLEMENT}\"
      }
    ]
  }" \
  "${OPENFGA_ENDPOINT}/stores/default/write"

echo "✓ User ${USER_EMAIL} has been granted ${ENTITLEMENT} entitlement"
```

---

### ユースケース2: プレミアムユーザーへのアップグレード

**要件:** ユーザーを `basic-plan` から `premium-plan` にアップグレード

#### アップグレードスクリプト

```bash
#!/bin/bash

USER_EMAIL="alice@example.com"
OLD_ENTITLEMENT="basic-plan"
NEW_ENTITLEMENT="premium-plan"

# 古いエンタイトルメントを削除し、新しいエンタイトルメントを付与
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"writes\": [
      {
        \"user\": \"user:${USER_EMAIL}\",
        \"relation\": \"holder\",
        \"object\": \"entitlement:${NEW_ENTITLEMENT}\"
      }
    ],
    \"deletes\": [
      {
        \"user\": \"user:${USER_EMAIL}\",
        \"relation\": \"holder\",
        \"object\": \"entitlement:${OLD_ENTITLEMENT}\"
      }
    ]
  }" \
  "${OPENFGA_ENDPOINT}/stores/default/write"

echo "✓ User ${USER_EMAIL} upgraded from ${OLD_ENTITLEMENT} to ${NEW_ENTITLEMENT}"
```

---

### ユースケース3: 部署別グループ権限管理

**要件:**
- 開発部門: すべてのLLMモデルにアクセス可能
- マーケティング部門: Claude-3 Haiku と画像生成のみ
- 営業部門: Claude-3 Haiku とチャット機能のみ

#### セットアップスクリプト

```bash
#!/bin/bash

# ========================================
# 開発部門
# ========================================

# グループにLLM権限を付与
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "group:dev-team", "relation": "accessor", "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"},
      {"user": "group:dev-team", "relation": "accessor", "object": "llm:anthropic.claude-3-opus-20240229-v1:0"},
      {"user": "group:dev-team", "relation": "accessor", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

# ユーザーをグループに追加
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "user:dev1@example.com", "relation": "member", "object": "group:dev-team"},
      {"user": "user:dev2@example.com", "relation": "member", "object": "group:dev-team"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

# ========================================
# マーケティング部門
# ========================================

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "group:marketing-team", "relation": "accessor", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"},
      {"user": "group:marketing-team", "relation": "enabled_user", "object": "feature:image-generation"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "user:marketing1@example.com", "relation": "member", "object": "group:marketing-team"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

# ========================================
# 営業部門
# ========================================

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "group:sales-team", "relation": "accessor", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"},
      {"user": "group:sales-team", "relation": "enabled_user", "object": "feature:chat"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "user:sales1@example.com", "relation": "member", "object": "group:sales-team"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

echo "✓ Department groups configured successfully"
```

---

### ユースケース4: エンタイトルメントパッケージの作成

**要件:** 以下の3つのプランを定義

| プラン | LLMモデル | 機能 |
|--------|-----------|------|
| **free** | Haiku | Chat |
| **basic** | Haiku, Sonnet | Chat, Image Generation |
| **premium** | Haiku, Sonnet, Opus | Chat, Image Generation, Video Generation, RAG |

#### プラン定義スクリプト

```bash
#!/bin/bash

# ========================================
# Free Plan
# ========================================

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "entitlement:free-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"},
      {"user": "entitlement:free-plan", "relation": "via_enable", "object": "feature:chat"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

# ========================================
# Basic Plan
# ========================================

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "entitlement:basic-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"},
      {"user": "entitlement:basic-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"},
      {"user": "entitlement:basic-plan", "relation": "via_enable", "object": "feature:chat"},
      {"user": "entitlement:basic-plan", "relation": "via_enable", "object": "feature:image-generation"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

# ========================================
# Premium Plan
# ========================================

awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "writes": [
      {"user": "entitlement:premium-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-5-haiku-20241022-v1:0"},
      {"user": "entitlement:premium-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"},
      {"user": "entitlement:premium-plan", "relation": "via_access", "object": "llm:anthropic.claude-3-opus-20240229-v1:0"},
      {"user": "entitlement:premium-plan", "relation": "via_enable", "object": "feature:chat"},
      {"user": "entitlement:premium-plan", "relation": "via_enable", "object": "feature:image-generation"},
      {"user": "entitlement:premium-plan", "relation": "via_enable", "object": "feature:video-generation"},
      {"user": "entitlement:premium-plan", "relation": "via_enable", "object": "feature:rag"}
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"

echo "✓ All entitlement plans configured"
```

---

## 5. 権限の確認と削除

### 5.1 権限の確認

#### 特定ユーザーの全権限を確認

```bash
# Read APIで特定ユーザーのTupleを取得
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "user": "user:alice@example.com"
    }
  }' "${OPENFGA_ENDPOINT}/stores/default/read"
```

**レスポンス例:**
```json
{
  "tuples": [
    {
      "key": {
        "user": "user:alice@example.com",
        "relation": "holder",
        "object": "entitlement:basic-plan"
      },
      "timestamp": "2025-10-22T10:30:00Z"
    },
    {
      "key": {
        "user": "user:alice@example.com",
        "relation": "member",
        "object": "group:premium-users"
      },
      "timestamp": "2025-10-22T09:15:00Z"
    }
  ]
}
```

#### 特定LLMにアクセスできるユーザーを確認

```bash
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-5-sonnet-20240620-v1:0"
    }
  }' "${OPENFGA_ENDPOINT}/stores/default/read"
```

### 5.2 権限の削除

#### 特定の権限を削除

```bash
# alice から basic-plan エンタイトルメントを削除
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "deletes": [
      {
        "user": "user:alice@example.com",
        "relation": "holder",
        "object": "entitlement:basic-plan"
      }
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"
```

#### ユーザーをグループから削除

```bash
# alice を premium-users グループから削除
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "deletes": [
      {
        "user": "user:alice@example.com",
        "relation": "member",
        "object": "group:premium-users"
      }
    ]
  }' "${OPENFGA_ENDPOINT}/stores/default/write"
```

---

## 6. ベストプラクティス

### 6.1 エンタイトルメントを使う

❌ **避けるべきパターン:**
```bash
# ユーザーに直接大量の権限を付与
user:alice → accessor → llm:claude-3-haiku
user:alice → accessor → llm:claude-3-sonnet
user:alice → enabled_user → feature:chat
user:alice → enabled_user → feature:image-generation
...
```

✅ **推奨パターン:**
```bash
# エンタイトルメント経由で権限を集約
user:alice → holder → entitlement:basic-plan
entitlement:basic-plan → via_access → llm:claude-3-haiku
entitlement:basic-plan → via_access → llm:claude-3-sonnet
entitlement:basic-plan → via_enable → feature:chat
...
```

**理由:**
- プラン変更が1つのTuple変更で済む
- 権限の見通しが良い
- 監査が容易

### 6.2 グループを活用する

部署やチーム単位での権限管理には、グループを使いましょう。

```bash
# グループに権限を付与
group:dev-team → accessor → llm:claude-3-opus

# ユーザーをグループに追加するだけ
user:alice → member → group:dev-team
user:bob → member → group:dev-team
```

### 6.3 命名規則を統一する

| オブジェクト | 命名規則 | 例 |
|------------|----------|-----|
| **ユーザー** | `user:{email}` | `user:alice@example.com` |
| **グループ** | `group:{team-name}` | `group:dev-team`, `group:sales-team` |
| **エンタイトルメント** | `entitlement:{plan-name}` | `entitlement:basic-plan`, `entitlement:premium-plan` |
| **LLM** | `llm:{model-id}` | `llm:anthropic.claude-3-5-sonnet-20240620-v1:0` |
| **機能** | `feature:{feature-name}` | `feature:chat`, `feature:image-generation` |

### 6.4 権限変更のログを取る

OpenFGAのTupleには `timestamp` が自動的に記録されますが、アプリケーション側でも変更履歴を記録しましょう。

```typescript
// 権限変更時のログ例
console.log({
  action: 'grant_permission',
  timestamp: new Date().toISOString(),
  admin: 'admin@example.com',
  user: 'alice@example.com',
  permission: 'entitlement:premium-plan',
  reason: 'User upgraded to premium plan',
});
```

### 6.5 定期的な権限監査

月次で以下を確認しましょう：

```bash
# 1. すべてのエンタイトルメントの利用状況を確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"tuple_key": {"relation": "holder"}}' \
  "${OPENFGA_ENDPOINT}/stores/default/read"

# 2. 特定のLLMへのアクセス権を持つユーザー数を確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "tuple_key": {
      "relation": "accessor",
      "object": "llm:anthropic.claude-3-opus-20240229-v1:0"
    }
  }' \
  "${OPENFGA_ENDPOINT}/stores/default/read"
```

---

## 付録: よく使うコマンド一覧

### A. 基本的な権限付与

```bash
# ユーザーにエンタイトルメントを付与
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"writes":[{"user":"user:USER_EMAIL","relation":"holder","object":"entitlement:PLAN_NAME"}]}' \
  "${OPENFGA_ENDPOINT}/stores/default/write"

# ユーザーをグループに追加
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"writes":[{"user":"user:USER_EMAIL","relation":"member","object":"group:GROUP_NAME"}]}' \
  "${OPENFGA_ENDPOINT}/stores/default/write"

# グループにLLM権限を付与
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"writes":[{"user":"group:GROUP_NAME","relation":"accessor","object":"llm:MODEL_ID"}]}' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

### B. 権限確認

```bash
# 特定ユーザーの権限を確認
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"tuple_key":{"user":"user:USER_EMAIL","relation":"accessor","object":"llm:MODEL_ID"}}' \
  "${OPENFGA_ENDPOINT}/stores/default/check"

# ユーザーのすべてのTupleを取得
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"tuple_key":{"user":"user:USER_EMAIL"}}' \
  "${OPENFGA_ENDPOINT}/stores/default/read"
```

### C. 権限削除

```bash
# エンタイトルメントを削除
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"deletes":[{"user":"user:USER_EMAIL","relation":"holder","object":"entitlement:PLAN_NAME"}]}' \
  "${OPENFGA_ENDPOINT}/stores/default/write"

# グループから削除
awscurl --service execute-api --region ${TENANT_REGION} \
  -X POST -H "Content-Type: application/json" \
  -d '{"deletes":[{"user":"user:USER_EMAIL","relation":"member","object":"group:GROUP_NAME"}]}' \
  "${OPENFGA_ENDPOINT}/stores/default/write"
```

---

## 利用可能なLLMモデルID一覧

```
llm:anthropic.claude-3-5-sonnet-20240620-v1:0
llm:anthropic.claude-3-5-sonnet-20241022-v2:0
llm:anthropic.claude-3-5-haiku-20241022-v1:0
llm:anthropic.claude-3-opus-20240229-v1:0
llm:anthropic.claude-3-sonnet-20240229-v1:0
llm:anthropic.claude-3-haiku-20240307-v1:0
```

## 利用可能な機能名一覧

```
feature:chat
feature:image-generation
feature:video-generation
feature:rag
feature:agent
feature:transcript
feature:summarize
feature:editorial
feature:translate
feature:pptx-generation
```

---

## 次のステップ

権限付与の方法を理解したら、実際にテナントに権限を設定してみましょう。

問題が発生した場合は、[認可システムガイド](./AUTHORIZATION_SYSTEM.md) のトラブルシューティングセクションを参照してください。
