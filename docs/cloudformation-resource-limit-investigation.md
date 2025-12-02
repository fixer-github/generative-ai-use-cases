# CloudFormation リソース上限問題の調査依頼

## 背景

AWS CDKでマルチテナントSaaSアプリケーションを構築しています。課金管理機能を`BillingManagementStack`としてNestedStackで実装したところ、親スタック（`GenerativeAiUseCasesStack`）のリソース数が500を超えてしまい、CloudFormationのスタックあたり500リソース制限に抵触する問題が発生しました。

## 現在の構成

### スタック構造

```
GenerativeAiUseCasesStack (親スタック)
├── Auth (Cognito)
├── Api (API Gateway REST API) ← ★ここで作成
├── Database
├── その他多数のConstruct
└── BillingManagementStack (NestedStack)
    ├── PlanManagementApi
    ├── SubscriptionManagementApi
    └── PaymentGatewayApi
```

### 実装詳細

**親スタック** ([generative-ai-use-cases-stack.ts:108-142](packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts))
```typescript
// 親スタックでAPI Gatewayを作成
const api = new Api(this, 'API', { ... });

// BillingManagementStackに親のAPI Gatewayを渡す
new BillingManagementStack(this, `BillingManagementStack${params.env}`, {
  api: api.restApi,  // ← 親のRestApiを渡している
  userPool: auth.userPool,
  idPool: auth.idPool,
  tenantManager: tenantManager,
  environment: params.env,
});
```

**BillingManagementStack** ([billing-management-stack.ts:56-96](packages/cdk/lib/stacks/nested/billing-management-stack.ts))
```typescript
export class BillingManagementStack extends NestedStack {
  constructor(scope: Construct, id: string, props: BillingManagementStackProps) {
    super(scope, id, props);

    // 親のAPI Gatewayに対してリソースを追加
    const subscriptionApi = new SubscriptionManagementApi(this, 'SubscriptionManagement', {
      api: props.api,  // ← 親のRestApiを使用
      ...
    });
  }
}
```

**SubscriptionManagementApi** ([subscription-management.ts:282-377](packages/cdk/lib/construct/api/subscription-management.ts))
```typescript
// 親のAPI Gatewayに直接リソースを追加
const adminResource = api.root.resourceForPath('/admin');
const billingResource = adminResource.addResource('billing');
const subscriptionsResource = billingResource.addResource('subscriptions');
// ... 多数のResource/Methodを追加
```

## 問題点

### 期待していた動作
- NestedStackは親スタックから見て「1リソース」としてカウントされる
- BillingManagementStack内の全リソース（Lambda関数、API Gateway Resource/Methodなど）は、親スタックのリソース数に含まれない

### 実際の動作
- **Lambda関数**: NestedStack内で作成されているため、親スタックでは「BillingManagementStack」として1リソースのみカウント（期待通り）
- **API Gateway Resource/Method**: 親のRestApiに対して直接追加されているため、**親スタックのリソース数として直接カウント**される（問題）

### 具体的な影響

BillingManagementStackから以下のリソースが作成されます：
- Lambda関数: 約23個（NestedStackでカウント → 親では1リソース）
- API Gateway Resources: 約15-20個（親スタックでカウント）
- API Gateway Methods: 約15-20個（親スタックでカウント）
- Authorizers: 数個（親スタックでカウント）

結果として、**API Gateway関連リソースだけで30-40個が親スタックのリソース数に加算**され、500リソース制限を圧迫しています。

## 検討した解決策とその課題

### 案1: BillingManagementStack専用のAPI Gatewayを新規作成

**内容**: NestedStack内で独立したAPI Gatewayを作成し、そこにBilling関連のエンドポイントを集約する

**メリット**:
- NestedStack内で完結するため、親スタックのリソース数に影響しない

**デメリット**:
- フロントエンドで2つのAPI URLを管理する必要がある
  - 既存: `https://api.example.com/admin/...`
  - 新規: `https://billing-api.example.com/admin/...`
- CORS設定を2箇所で管理
- Cognito Authorizerを両方のAPI Gatewayで設定
- カスタムドメインを使う場合、API Gateway Custom Domain + Base Path Mappingの追加設定が必要
- フロントエンドの変更範囲が大きい

### 案2: Lambda Function URLを使用

**内容**: API Gatewayを経由せず、Lambda Function URLで直接公開

**メリット**:
- API Gateway関連のCloudFormationリソースが不要
- 大幅なリソース削減

**デメリット**:
- 既存のAPI Gateway統合から大きく設計変更
- 統一されたAPI管理が難しくなる
- API Gatewayの機能（スロットリング、使用量プランなど）が使えない

### 案3: API Gatewayリソース構造の最適化

**内容**: エンドポイントを統合してリソース数を削減
```
変更前:
POST /admin/billing/subscriptions/{id}/approve
POST /admin/billing/subscriptions/{id}/reject

変更後:
POST /admin/billing/subscriptions/{id}?action=approve
POST /admin/billing/subscriptions/{id}?action=reject
```

**メリット**:
- リソース数を削減できる

**デメリット**:
- RESTfulな設計から逸脱
- 保守性が低下

### 案4: HTTP APIへの移行

**内容**: REST APIではなくHTTP APIを使用

**メリット**:
- REST APIよりCloudFormationリソースが少ない

**デメリット**:
- 大規模な移行作業が必要
- 既存のREST API機能との互換性確認が必要

## 調査してほしいこと

以下の観点で、最適な解決策を調査・提案してください：

### 1. ベストプラクティスの調査
- AWS CDKで大規模なAPI Gateway構成を持つ場合の推奨パターン
- NestedStackとAPI Gatewayを組み合わせる際のベストプラクティス
- 500リソース制限を回避するための一般的なアーキテクチャパターン

### 2. 各解決策の詳細評価
上記の4つの案について：
- 実装の難易度（工数見積もり）
- 運用上の影響
- セキュリティ面での考慮点
- パフォーマンスへの影響
- 長期的な保守性

### 3. 他の解決策の提案
上記以外に、以下のような観点で解決策があれば提案してください：
- CloudFormationの制限を回避する技術的な手法
- AWS CDKの機能を活用した最適化
- アーキテクチャの再設計（マイクロサービス化など）

### 4. 推奨アプローチ
以下の優先順位を考慮した上で、最も現実的な解決策を提示してください：
1. **実装コストの低さ**（既存コードへの影響が少ない）
2. **保守性の高さ**（長期的に管理しやすい）
3. **フロントエンドへの影響の少なさ**
4. **スケーラビリティ**（将来的にさらにエンドポイントが増える可能性）

## 参考情報

### 現在のリソース数
- GenerativeAiUseCasesStack: 500リソース超（正確な数は要確認）
- BillingManagementStack内のLambda関数: 約23個
- BillingManagementStackから親APIに追加されるAPI Gateway関連リソース: 30-40個

### 技術スタック
- AWS CDK（TypeScript）
- API Gateway REST API
- Lambda（Node.js）
- Cognito（認証）
- マルチテナントアーキテクチャ

### コードの場所
- 親スタック: `packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`
- BillingManagementStack: `packages/cdk/lib/stacks/nested/billing-management-stack.ts`
- API Constructs: `packages/cdk/lib/construct/api/`

## 期待するアウトプット

以下の形式で調査結果をまとめてください：

1. **問題の整理**: 現状の問題点の要約
2. **解決策の比較表**: 各案のメリット・デメリット、実装難易度、影響範囲
3. **推奨アプローチ**: 具体的な実装ステップと考慮点
4. **リスクと緩和策**: 実装時のリスクとその対処法
5. **代替案**: 推奨案がうまくいかない場合の次善策

よろしくお願いします。
