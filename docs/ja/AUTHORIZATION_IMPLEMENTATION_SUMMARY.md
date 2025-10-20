# 認可システム実装サマリー

## 実装完了状況

### ✅ Phase 1: ドキュメント作成 (完了)

4つの包括的な日本語ドキュメントを作成:

1. **authorization-mvp.md** - MVPアーキテクチャガイド
   - SpiceDB選定の理由と根拠
   - システム全体アーキテクチャ（Mermaid図付き）
   - 各コンポーネントの詳細説明
   - デプロイメント戦略
   - 監視・セキュリティ・トラブルシューティング

2. **authorization-schema.md** - スキーマ設計
   - SpiceDB完全スキーマ定義
   - Caveat活用例（クォータチェック）
   - エンティティと関係性
   - マイグレーション戦略
   - パフォーマンス最適化

3. **authorization-api-integration.md** - API統合ガイド
   - Lambda Authorizer完全実装コード
   - SpiceDBクライアント統合
   - Usage Tracker実装
   - Webフロントエンド統合
   - テストコード例

4. **authorization-plan-quota.md** - プラン・クォータ管理
   - プラン階層定義（Free/Pro/Enterprise）
   - 詳細機能比較表
   - プラン管理API
   - クォータ自動リセット
   - 使用量レポート・アラート
   - Stripe連携設計

### ✅ Phase 2: 型定義とインフラ基盤 (完了)

5. **TypeScript型定義** (`packages/types/src/authorization.d.ts`)
   - プラン・サブスクリプション型
   - 認可チェック型
   - SpiceDB型（Relationship, Caveat等）
   - 使用量追跡型
   - CDK Construct Props型
   - メインパッケージからエクスポート済み

6. **DynamoDB CDK Construct** (`packages/cdk/lib/construct/authorization/plan-quota-store.ts`)
   - **PlansTable**: プラン定義と権限
   - **TenantPlansTable**: テナント-プラン割り当て
     - GSI: plan_id, stripe_subscription_id, status
   - **UsageTable**: 使用量カウンター（TTL付き）
     - GSI: tenant_id-date, model, plan_id-date
   - きめ細かいIAM Grant メソッド

7. **SpiceDB認可スキーマ** (`packages/cdk/lib/construct/spicedb/authorization-schema.zed`)
   - 完全なSpiceDB schema定義（.zed形式）
   - エンティティ: user, tenant, plan, conversation, document, usecase, model
   - Caveat: `quota_available` - クォータチェック用
   - model_with_quota: クォータ付きモデルアクセス制御
   - 詳細なコメントと使用例付き

## 技術選定: SpiceDB

### 選定根拠

Codex分析に基づき、**SpiceDBの単独採用**を決定:

| 要素 | 理由 |
|------|------|
| **既存インフラ活用** | EKS/RDS既に稼働中、追加デプロイ不要 |
| **Caveats機能** | クォータチェックに最適な条件付き権限 |
| **運用実績** | Kubernetes Operatorによる自動管理 |
| **本番対応** | Zanzibar実装として最も成熟 |
| **コスト効率** | デュアルシステム不要、運用コスト削減 |

### アーキテクチャ概要

```
┌─────────────┐
│ Web App     │
└─────┬───────┘
      │ JWT Token
      ▼
┌─────────────────┐
│ API Gateway     │
│ + Authorizer    │◄─────┐
└────────┬────────┘      │
         │                │
         │ Cognito        │
         │ Verify         │
         │                │
    ┌────▼────┐    ┌─────▼──────┐
    │ Cognito │    │ DynamoDB   │
    └─────────┘    │ Plan/Quota │
                   └─────┬──────┘
                         │
                    ┌────▼────────┐
                    │ SpiceDB     │
                    │ (EKS/RDS)   │
                    │ + Caveats   │
                    └─────────────┘
```

## ファイル構成

```
docs/ja/
├── authorization-mvp.md                    # MVPガイド（SpiceDB版）
├── authorization-schema.md                 # スキーマ設計
├── authorization-api-integration.md        # API統合
├── authorization-plan-quota.md             # プラン管理
└── AUTHORIZATION_IMPLEMENTATION_SUMMARY.md # このファイル

packages/types/src/
├── authorization.d.ts                      # 認可システム型定義
└── index.d.ts                              # エクスポート設定

packages/cdk/lib/construct/
├── authorization/
│   └── plan-quota-store.ts                 # DynamoDBテーブル
└── spicedb/
    ├── authorization-schema.zed            # SpiceDBスキーマ
    ├── spicedb-tenant.d.ts                 # 既存テナント定義
    ├── spicedb-shared-namespace.*          # 既存共有NS
    └── spicedb-dedicated-cluster.*         # 既存専用クラスタ
```

## 次の実装タスク

### Phase 3: Lambda関数実装

- [ ] **Lambda Authorizer** - SpiceDBクライアント統合
  - Cognito JWT検証
  - SpiceDB権限チェック
  - Caveat Contextでクォータチェック
  - IAM Policy生成

- [ ] **Usage Tracker** - EventBridge → DynamoDB更新
  - 使用量カウンター原子的更新
  - クォータ超過検知
  - SpiceDB Relationship更新

- [ ] **Schema Migration** - SpiceDBスキーマ適用
  - authorization-schema.zed適用
  - Namespace初期化

### Phase 4: CDK統合

- [ ] **AuthorizationSystem Construct** - メインコンストラクト
  - PlanQuotaStore統合
  - SpiceDB接続設定
  - Lambda Authorizer作成
  - UsageTracker作成
  - EventBridge Rule設定

- [ ] **API Gateway統合**
  - Authorizer attachment
  - 既存APIへの適用

### Phase 5: テスト・検証

- [ ] 型チェック（`npm run cdk:lint`）
- [ ] 単体テスト
- [ ] 統合テスト
- [ ] ドキュメントTextlint

## 見積もり

- ✅ Phase 1-2: 完了 (~6時間)
- Phase 3: Lambda実装 (~6-8時間)
- Phase 4: CDK統合 (~4-6時間)
- Phase 5: テスト (~4-6時間)

**残り: 14-20時間**

## 主要な実装ポイント

### 1. SpiceDB Caveat活用

クォータチェックをCaveatで実現:

```typescript
// Lambda Authorizerでの実装例
const result = await spiceDBClient.checkPermission({
  resource: {
    objectType: 'model_with_quota',
    objectId: 'claude-3-sonnet'
  },
  permission: 'execute',
  subject: {
    object: { objectType: 'user', objectId: userId }
  },
  context: {
    current_usage: currentUsage,  // DynamoDBから取得
    quota_limit: quotaLimit        // Planから取得
  }
});
```

### 2. DynamoDB + SpiceDB ハイブリッド

- **DynamoDB**: プラン設定、使用量カウンター（高速更新）
- **SpiceDB**: 権限関係、条件付きアクセス制御（厳密な整合性）

### 3. 既存インフラ活用

- SpiceDB EKS/RDS既存クラスタ利用
- テナント別Namespace分離
- Kubernetes Operator自動管理

## 付録: SpiceDBコマンド例

```bash
# スキーマ適用
zed schema write --schema authorization-schema.zed

# Relationship作成
zed relationship create \
  tenant:acme member user:alice

# 権限チェック
zed permission check \
  conversation:123 view user:alice

# Caveat付き権限チェック
zed permission check \
  model_with_quota:claude-3-sonnet execute user:alice \
  --caveat-context '{"current_usage":8,"quota_limit":50}'

# Relationshipリスト
zed relationship read \
  --filter 'tenant:acme#'
```

## 参考資料

- [SpiceDB公式](https://authzed.com/docs)
- [SpiceDB Caveats](https://authzed.com/docs/spicedb/concepts/caveats)
- [Zanzibar論文](https://research.google/pubs/pub48190/)
- [AWS Lambda Authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html)
