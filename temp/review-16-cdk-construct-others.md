# レビュー結果: CDK Construct - Others

## 担当ファイル
- packages/cdk/lib/construct/tenant-payment-gateway-database.ts (新規作成)
- packages/cdk/lib/construct/tenant-role.ts
- packages/cdk/lib/construct/tenant-dynamodb.ts
- packages/cdk/lib/construct/use-case-builder.ts
- packages/cdk/lib/construct/web.ts

## 重大な問題（Critical）

### 1. DynamoDBテーブルの暗号化設定削除（tenant-dynamodb.ts）

**問題**: 複数のDynamoDBテーブルから `encryption: dynamodb.TableEncryption.AWS_MANAGED` 設定が削除されている

**影響箇所**:
- ChatHistoryTable (L151)
- TokenUsageStatsTable (L182)
- UseCaseBuilderTable (L215)
- AssistantTable (L248)
- AssistantMessagesTable (L281)
- createTenantTable メソッド内のテーブル (L387)

**セキュリティへの影響**:
- DynamoDBのデフォルト暗号化は有効だが、明示的な暗号化設定が削除されたことで、コンプライアンス要件を満たせない可能性がある
- セキュリティベースラインの後退となり、監査時に問題となる可能性が高い
- 特に、個人情報や会話履歴、トークン利用統計などの機密データを含むテーブルでこの変更は重大

**リスクレベル**: **高** - セキュリティとコンプライアンスの観点から重大な後退

**推奨対応**:
- すべてのテーブルに `encryption: dynamodb.TableEncryption.AWS_MANAGED` を再追加すべき
- またはより強力な `dynamodb.TableEncryption.CUSTOMER_MANAGED` の使用を検討

---

### 2. TenantVisibilityIndex の削除（tenant-dynamodb.ts）

**問題**: AssistantTable から TenantVisibilityIndex が削除されている（L267-279）

**削除されたコード**:
```typescript
this.assistantTable.addGlobalSecondaryIndex({
  indexName: 'TenantVisibilityIndex',
  partitionKey: {
    name: 'tenantId',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'createdDate',
    type: dynamodb.AttributeType.STRING,
  },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**影響**:
- テナント横断での公開アシスタント検索機能が削除される
- アプリケーション側でこのインデックスを使用しているコードがある場合、実行時エラーが発生する
- マルチテナント環境での公開リソース共有機能が破損する可能性

**リスクレベル**: **高** - 機能削除による既存機能への影響の可能性

**推奨対応**:
- この削除が意図的かどうか確認が必要
- アプリケーション層でこのインデックスへの依存がないか確認すべき

---

### 3. Payment Gateway Database の暗号化設定欠落（tenant-payment-gateway-database.ts）

**問題**: 新規作成された決済システム用テーブルに暗号化設定が明示されていない

**対象テーブル**:
- webhookEventTable (L27-41)
- receiptCacheTable (L57-66)

**セキュリティへの影響**:
- 決済関連データは最も機密性の高いデータの一つ
- Webhookイベントログやレシート検証キャッシュには決済プラットフォームからの重要情報が含まれる
- PCI DSS等の決済系コンプライアンス要件を満たせない可能性が高い

**リスクレベル**: **極めて高い** - 決済データの保護要件違反

**推奨対応**:
- 両テーブルに `encryption: dynamodb.TableEncryption.AWS_MANAGED` を追加
- 決済データの性質上、`dynamodb.TableEncryption.CUSTOMER_MANAGED` の使用を強く推奨

---

### 4. IAM権限の過度な付与（tenant-role.ts）

**問題1**: Lambda呼び出し権限がワイルドカード指定（L166）

```typescript
resources: [
  `arn:aws:lambda:${props.region}:${props.account}:function:*`,
],
```

**セキュリティリスク**:
- テナント専用ロールが同一アカウントの**すべての**Lambda関数を呼び出せる
- テナント分離が破られ、他テナントのリソースにアクセスできる可能性
- 最小権限の原則に違反

**問題2**: API Gateway呼び出し権限がワイルドカード指定（L208）

```typescript
resources: [
  `arn:aws:execute-api:${props.region}:${props.account}:*`,
],
```

**セキュリティリスク**:
- すべてのAPI Gatewayエンドポイントへのアクセスが可能
- 他テナントのAPI、管理API等にアクセスできる可能性
- OpenFGA認証システム以外のAPIにもアクセス可能

**問題3**: RDS IAM認証がワイルドカード指定（L230）

```typescript
resources: [
  `arn:aws:rds-db:${props.region}:${props.account}:dbuser:*/*`,
],
```

**セキュリティリスク**:
- すべてのRDSデータベースの全ユーザーとして認証可能
- テナント間のデータ分離が破られる可能性
- DBレベルの権限制御に依存せざるを得ない（多層防御の原則違反）

**リスクレベル**: **極めて高い** - マルチテナント環境でのテナント分離違反

**推奨対応**:
- Lambda: テナントIDを含む命名規則でリソースを制限
  ```typescript
  resources: [
    `arn:aws:lambda:${props.region}:${props.account}:function:*-${props.tenantId}-*`,
  ],
  ```
- API Gateway: 特定のAPIのみに制限
  ```typescript
  resources: [
    `arn:aws:execute-api:${props.region}:${props.account}:${openfgaApiId}/*`,
  ],
  ```
- RDS: 特定のDBクラスターとテナント専用ユーザーに制限
  ```typescript
  resources: [
    `arn:aws:rds-db:${props.region}:${props.account}:dbuser:${tenantDbClusterId}/${props.tenantId}-*`,
  ],
  ```

---

## 警告レベルの問題（Warning）

### 1. SSMパラメータアクセス権限の範囲（tenant-role.ts）

**問題**: SSMパラメータのパスが広範囲（L219）

```typescript
resources: [
  `arn:aws:ssm:${props.region}:${props.account}:parameter/genu-gaixer/tenants/${props.tenantId}/*`,
],
```

**潜在的リスク**:
- テナント配下のすべてのパラメータにアクセス可能
- 将来的に機密性の異なるパラメータが追加された場合、意図しないアクセスが発生する可能性

**推奨対応**:
- 用途別にパラメータパスを細分化し、必要なものだけにアクセス許可
- 例: `/genu-gaixer/tenants/${props.tenantId}/rds/connection-info`, `/genu-gaixer/tenants/${props.tenantId}/openfga/endpoint` など

---

### 2. Payment Gateway Database のポイントインタイムリカバリ設定の不整合

**問題**: webhookEventTable にはPITRが有効（L40）だが、receiptCacheTable には設定されていない（L57-66）

**影響**:
- receiptCacheTable のデータ損失時にリカバリができない
- 両テーブルとも決済関連データを扱うため、一貫した保護が必要

**推奨対応**:
- receiptCacheTable にも `pointInTimeRecovery: true` を追加
- ただし、TTL設定されたキャッシュテーブルの性質上、PITRが不要な場合は両方から削除を検討

---

### 3. Use Case Builder Table の暗号化設定削除（use-case-builder.ts）

**問題**: L42 から `encryption: dynamodb.TableEncryption.AWS_MANAGED` が削除されている

**影響**:
- tenant-dynamodb.ts と同様のセキュリティリスク
- ユースケース定義データの保護が弱まる

**推奨対応**:
- 暗号化設定を再追加

---

### 4. Web環境変数への直接的なBilling APIエンドポイント露出（web.ts）

**問題**: L234で Billing APIエンドポイントがクライアント側に直接露出

```typescript
VITE_APP_BILLING_API_ENDPOINT: `${props.billingApiEndpointUrl}admin/billing/`,
```

**セキュリティ懸念**:
- "admin/billing/" パスが環境変数に含まれ、クライアントサイドコードに埋め込まれる
- 管理者専用エンドポイントがエンドユーザーに知られる可能性
- パス構造の変更がフロントエンドとバックエンドの両方に影響

**推奨対応**:
- バックエンドAPIでプロキシ経由でアクセスさせる構成を検討
- または、パスの命名を再検討（"admin"を含めない）

---

## 軽微な問題・改善提案（Info）

### 1. Payment Gateway Database の命名規則の整合性

**観察**: テーブル名のプレフィックスパターンが他のリソースと異なる

```typescript
tableName: `${tenantId}-payment-gateway-webhook-events`
tableName: `${tenantId}-payment-gateway-receipt-cache`
```

**既存パターン** (tenant-dynamodb.ts):
```typescript
tableName: `${baseName}-${environment}-tenant-${sanitizedTenantId}`
```

**影響**:
- 命名規則の不整合により、運用時のリソース特定が困難になる可能性
- 環境（dev/staging/prod）の区別がテーブル名に含まれていない

**推奨対応**:
- 既存の命名規則に合わせる、または新規パターンを採用する場合はドキュメント化
- environment パラメータを追加し、テーブル名に含める

---

### 2. Payment Gateway Database のGSIにprojectionTypeが未指定

**問題**: PlatformTypeIndex でprojectionTypeが指定されていない（L44-54）

```typescript
this.webhookEventTable.addGlobalSecondaryIndex({
  indexName: 'PlatformTypeIndex',
  partitionKey: { ... },
  sortKey: { ... },
  // projectionType が未指定（デフォルトはALL）
});
```

**影響**:
- デフォルトで `ProjectionType.ALL` となり、すべての属性が投影される
- ストレージコストとパフォーマンスへの影響
- 意図が明示されていない

**推奨対応**:
- 明示的に `projectionType: dynamodb.ProjectionType.ALL` を指定
- または必要な属性のみを投影する `KEYS_ONLY` や `INCLUDE` を検討

---

### 3. Payment Gateway Database のコンストラクタにタグ設定がない

**観察**: TenantDynamoDB では Tags.of() でタグを設定しているが、TenantPaymentGatewayDatabase では設定されていない

**影響**:
- リソース管理、コスト配分、監査の際にテナント識別が困難
- 他のリソースとのタグ付け方針の不整合

**推奨対応**:
- 両テーブルに TenantId と Environment タグを追加
```typescript
Tags.of(this.webhookEventTable).add('TenantId', tenantId);
Tags.of(this.receiptCacheTable).add('TenantId', tenantId);
```

---

### 4. IAMポリシーのコメントの一貫性

**観察**: 新規追加されたIAMステートメントには詳細なコメントがあるが、一部が英語と日本語が混在

**例**:
```typescript
// Plan data access function (VPC内)  ← 混在
// Subscription data access function (VPC内)
```

**推奨対応**:
- コメントの言語を統一（英語推奨）
- または完全に日本語化

---

### 5. Removal Policy のデフォルト値の不整合

**tenant-payment-gateway-database.ts**:
```typescript
const { tenantId, removalPolicy = RemovalPolicy.RETAIN } = props;
```

**tenant-dynamodb.ts**:
```typescript
const removalPolicy = props.removalPolicy ||
  (environment === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN);
```

**影響**:
- Payment Gateway Database は常にRETAINがデフォルト
- 開発環境でもリソースが残り続ける可能性
- クリーンアップが困難

**推奨対応**:
- TenantPaymentGatewayDatabase にも environment パラメータを追加
- tenant-dynamodb.ts と同様のロジックを実装

---

### 6. Web構成での新規環境変数のドキュメント欠如

**問題**: `VITE_APP_BILLING_API_ENDPOINT` が追加されたが、インターフェース定義にはコメントがない（L28）

**推奨対応**:
- JSDocコメントを追加して用途を明確化
```typescript
/**
 * Billing API endpoint URL for payment and subscription management
 */
readonly billingApiEndpointUrl: string;
```

---

## セキュリティ上の懸念（まとめ）

### 高リスク項目
1. **DynamoDB暗号化設定の削除** - データ保護の基本要件違反
2. **Payment Gateway データベースの暗号化欠如** - PCI DSS等のコンプライアンス違反リスク
3. **IAM権限のワイルドカード使用** - テナント分離の破綻リスク

### 中リスク項目
1. **TenantVisibilityIndex削除** - 機能破損の可能性
2. **SSMパラメータアクセス範囲** - 過度な権限付与
3. **Billing APIエンドポイントの露出** - 管理パス情報の漏洩

### アーキテクチャ上の懸念
1. **最小権限の原則違反** - 特にLambda、API Gateway、RDSアクセス権限
2. **多層防御の欠如** - IAMレベルでのテナント分離が不十分
3. **命名規則の不整合** - 運用性への影響

---

## 総合評価

**評価: 要修正**

### 理由

1. **セキュリティ上の重大な後退**
   - DynamoDB暗号化設定の削除は、セキュリティベースラインの明確な後退
   - 決済データテーブルの暗号化欠如は、コンプライアンス要件違反の可能性が極めて高い

2. **マルチテナント分離の脆弱性**
   - IAM権限のワイルドカード使用により、テナント分離の根幹が脅かされる
   - Lambda、API Gateway、RDSアクセスすべてでこの問題が発生

3. **機能削除の影響が不明**
   - TenantVisibilityIndex削除の影響範囲が不明確
   - アプリケーション層への影響調査が必要

### 必須対応項目（リリース前に修正必須）

1. すべてのDynamoDBテーブルに暗号化設定を再追加
2. IAM権限のワイルドカードを削除し、テナント専用リソースに制限
3. 決済データテーブルに適切な暗号化とPITR設定を追加
4. TenantVisibilityIndex削除の影響を調査し、必要に応じて復元

### 推奨対応項目（優先度高）

1. SSMパラメータアクセス権限の細分化
2. Payment Gateway Database の命名規則とタグ設定の統一
3. Billing APIエンドポイント露出方法の再検討

### コードレビュー観点での総評

このブランチの変更は、Authorization System POCの実装という目的に対して、以下の問題を含んでいます：

- **セキュリティ強化が目的のはずが、既存のセキュリティ設定を削除している**（暗号化設定）
- **新機能追加時に、基本的なセキュリティ設定が欠落している**（Payment Gateway）
- **最小権限の原則を無視したIAM権限設定**（ワイルドカード多用）

これらは、機能実装を急ぐあまり、セキュリティとアーキテクチャの基本原則が軽視された結果と推察されます。

**本番環境へのデプロイ前に、上記の「必須対応項目」すべての修正を強く推奨します。**
