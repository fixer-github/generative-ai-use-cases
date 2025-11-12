# プラン管理API調査結果

## 実施日時
2025-11-12

## 調査概要
管理者向けプラン管理APIについて、フロントエンドとバックエンドのI/O一致性、CDKでのAPI公開設定、管理者権限制限の実装状況を調査しました。

---

## 1. フロントエンドとバックエンドのI/O一致性

### GET /admin/billing/plans
- **フロントエンド期待値**:
  - リクエスト: クエリパラメータ (page, limit, sort_by, sort_order, platform_type, status, search)
  - レスポンス: `{ plans: PlanListItem[], pagination: {...}, statistics: {...} }`
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/listPlans.ts`
  - リクエスト: 同一のクエリパラメータを処理
  - レスポンス: 同一の構造を返却
- **一致性判定**: ✅一致
- **備考**: フロントエンド(`usePlanApi.ts`)とバックエンドのI/Oスキーマは完全に一致しています

### GET /admin/billing/plans/{plan_id}
- **フロントエンド期待値**:
  - リクエスト: パスパラメータ `plan_id`
  - レスポンス: `Plan` オブジェクト（詳細情報含む）
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/getPlanDetails.ts`
  - リクエスト: パスパラメータ `plan_id` を処理
  - レスポンス: `Plan` オブジェクトを返却
- **一致性判定**: ✅一致
- **備考**: なし

### POST /admin/billing/plans
- **フロントエンド期待値**:
  - リクエスト: `CreatePlanRequest` オブジェクト
  - レスポンス: 作成された `Plan` オブジェクト（ステータスコード201）
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/createPlan.ts`
  - リクエスト: `CreatePlanRequest` を受け取り、詳細なバリデーションを実施
  - レスポンス: 作成された `Plan` オブジェクトを返却（ステータスコード201）
- **一致性判定**: ✅一致
- **備考**: バリデーションルールも仕様に準拠しています

### PATCH /admin/billing/plans/{plan_id}/status
- **フロントエンド期待値**:
  - リクエスト: パスパラメータ `plan_id` + ボディ `{ new_status: ... }`
  - レスポンス: `UpdatePlanStatusResponse` オブジェクト
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/updatePlanStatus.ts`
  - リクエスト: パスパラメータとボディを処理
  - レスポンス: `UpdatePlanStatusResponse` を返却
- **一致性判定**: ✅一致
- **備考**: ステータス遷移ルールの検証も実装済み

### GET /admin/billing/plans/{plan_id}/history
- **フロントエンド期待値**:
  - リクエスト: パスパラメータ `plan_id` + クエリパラメータ (page, limit)
  - レスポンス: `PlanHistoryResponse` オブジェクト
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/getPlanHistory.ts`
  - リクエスト: パスパラメータとクエリパラメータを処理
  - レスポンス: `PlanHistoryResponse` を返却
- **一致性判定**: ✅一致
- **備考**: なし

### GET /admin/billing/plans/{plan_id}/subscriptions
- **フロントエンド期待値**:
  - リクエスト: パスパラメータ `plan_id`
  - レスポンス: `PlanSubscriptionsResponse` オブジェクト（契約状況の統計情報）
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/getPlanSubscriptions.ts`
  - リクエスト: パスパラメータを処理
  - レスポンス: `PlanSubscriptionsResponse` を返却
- **一致性判定**: ✅一致
- **備考**: なし

### GET /admin/billing/plans/check-name
- **フロントエンド期待値**:
  - リクエスト: クエリパラメータ `internal_name`
  - レスポンス: `CheckNameResponse` オブジェクト
- **バックエンド実装**:
  - ファイル: `/packages/cdk/lambda/billing/admin/checkPlanName.ts`
  - リクエスト: クエリパラメータを処理
  - レスポンス: `CheckNameResponse` を返却
- **一致性判定**: ✅一致
- **備考**: なし

---

## 2. CDKでのAPI公開設定

### API Gatewayへの登録状況
- **実装ファイル**:
  - `/packages/cdk/lib/construct/api/plan-management.ts`
  - `/packages/cdk/lib/stacks/nested/billing-management-stack.ts`
  - `/packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`
- **エンドポイント定義**:
  - すべてのエンドポイント（7つのAPI）がAPI Gatewayに正しく登録されています
  - パス: `/admin/billing/plans`, `/admin/billing/plans/{plan_id}`, `/admin/billing/plans/{plan_id}/status` など
- **判定**: ❌未実装（Lambda関数のパス不一致により、デプロイ時にエラーが発生する可能性があります）
- **備考**:
  - **重大な問題**: CDKコンストラクトが期待するLambda関数のパスと実際のパスが一致していません
  - CDK期待パス: `./lambda/billing/admin/plan-management/listPlans.ts` など
  - 実際のパス: `./lambda/billing/admin/listPlans.ts`
  - **影響**: CDKスタックのデプロイ時に「Lambda関数のentryファイルが見つからない」というエラーが発生します
  - **対処が必要**: Lambda関数を正しいディレクトリ構造に移動するか、CDKコンストラクトのパスを修正する必要があります

### CORS設定
- **設定内容**:
  - Lambda関数内で `CORS_HEADERS` が定義され、すべてのレスポンスに含まれています
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Headers: *`
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- **判定**: ✅適切
- **備考**: CORSヘッダーは適切に設定されており、フロントエンドからのアクセスが可能です

### HTTPメソッド設定
- **設定内容**:
  - GET: `/admin/billing/plans`, `/admin/billing/plans/{plan_id}`, `/admin/billing/plans/{plan_id}/history`, `/admin/billing/plans/{plan_id}/subscriptions`, `/admin/billing/plans/check-name`
  - POST: `/admin/billing/plans`
  - PATCH: `/admin/billing/plans/{plan_id}/status`
- **判定**: ✅適切
- **備考**: すべてのHTTPメソッドが仕様通りに設定されています

### 認証設定
- **設定内容**:
  - Cognito User Pools Authorizer が設定されています
  - すべてのエンドポイントに `authorizer` が適用されています
- **判定**: ✅適切
- **備考**: Cognito認証が必須となっており、未認証のアクセスは拒否されます

---

## 3. 管理者権限制限

### OpenFGA権限チェック実装
- **実装ファイル**: `/packages/cdk/lambda/utils/adminAuth.ts`
- **実装方法**:
  - **ミドルウェア的なアプローチ**: `verifyAdminAccess()` 関数を各Lambda関数の冒頭で呼び出し
  - **リアルタイム権限チェック**: トークンのクレームだけでなく、Cognitoに問い合わせて現在の管理者権限を確認
  - **主要な実装内容**:
    1. JWTトークンの検証
    2. `verifyTokenWithRoleCheck()` を呼び出して、トークンのクレームとCognitoの現在の属性を比較
    3. `custom:tenantAdmin` 属性が "true" であるかを確認
    4. 権限が変更されている場合は、409 Conflict エラーを返す（セッション更新を促す）
- **判定**: ✅実装済み
- **備考**:
  - すべてのLambda関数で `verifyAdminAccess()` が呼び出されています
  - OpenFGAではなく、Cognitoの `custom:tenantAdmin` カスタム属性を使用した権限チェックです
  - リアルタイムチェックにより、権限が剥奪された後もトークンが有効な期間中の不正アクセスを防止しています

### 403エラーハンドリング
- **実装状況**:
  - 管理者権限がない場合: 403 Forbidden エラーを返却
  - 権限が変更された場合: 409 Conflict エラーを返却（`refreshRequired: true` フラグ付き）
  - 認証トークンがない場合: 401 Unauthorized エラーを返却
- **判定**: ✅適切
- **備考**: エラーメッセージも適切で、フロントエンドでの対応が可能です

### IAM権限設定
- **実装状況**:
  - Lambda実行ロールに以下の権限が付与されています:
    - `secretsmanager:GetSecretValue`: RDS接続情報の取得
    - `cognito-identity:GetId`, `cognito-identity:GetCredentialsForIdentity`: Cognito認証・認可
  - VPC設定（オプション）: RDSアクセスのためのVPC、セキュリティグループ設定をサポート
- **判定**: ✅適切
- **備考**: 最小権限の原則に従った権限設定がされています

---

## 4. 総合評価

### 問題点・懸念事項

#### 【重大】Lambda関数のパス不一致
- **詳細**:
  - CDKコンストラクト (`plan-management.ts`) が期待するパス: `./lambda/billing/admin/plan-management/*.ts`
  - 実際のLambda関数のパス: `./lambda/billing/admin/*.ts`
- **影響**:
  - CDKスタックのデプロイが失敗します
  - エラーメッセージ: "Cannot find module" または "Entry file not found"
- **対処方法**:
  1. **推奨**: Lambda関数を `plan-management/` サブディレクトリに移動する
     ```bash
     mkdir -p packages/cdk/lambda/billing/admin/plan-management
     mv packages/cdk/lambda/billing/admin/listPlans.ts packages/cdk/lambda/billing/admin/plan-management/
     mv packages/cdk/lambda/billing/admin/getPlanDetails.ts packages/cdk/lambda/billing/admin/plan-management/getPlan.ts
     mv packages/cdk/lambda/billing/admin/createPlan.ts packages/cdk/lambda/billing/admin/plan-management/
     mv packages/cdk/lambda/billing/admin/updatePlanStatus.ts packages/cdk/lambda/billing/admin/plan-management/
     mv packages/cdk/lambda/billing/admin/getPlanHistory.ts packages/cdk/lambda/billing/admin/plan-management/
     mv packages/cdk/lambda/billing/admin/getPlanSubscriptions.ts packages/cdk/lambda/billing/admin/plan-management/
     mv packages/cdk/lambda/billing/admin/checkPlanName.ts packages/cdk/lambda/billing/admin/plan-management/
     ```
     **注意**: `getPlanDetails.ts` は `getPlan.ts` にリネームする必要があります
  2. **代替案**: CDKコンストラクトのentryパスを修正する（非推奨: サブスクリプション管理APIも同じ構造のため統一性が失われる）

#### 【中】subscription-management APIとの整合性
- **詳細**:
  - Subscription Management API (`subscription-management.ts`) も同じく `./lambda/billing/admin/subscription-management/*.ts` を期待しています
  - 同様のパス不一致問題が発生する可能性があります
- **確認が必要**: Subscription Management APIのLambda関数が実際にどこに配置されているか確認してください

#### 【低】OpenFGAの利用
- **詳細**:
  - 仕様書ではOpenFGAによる管理者権限の検証が記載されていますが、実装ではCognitoの `custom:tenantAdmin` カスタム属性を使用しています
  - 機能的には問題ありませんが、仕様書との齟齬があります
- **影響**: 軽微（認可機能自体は実装されており、リアルタイムチェックも行われています）
- **対処方法**: 仕様書を実装に合わせて更新するか、将来的にOpenFGA統合を検討してください

#### 【低】RDS接続の前提条件
- **詳細**:
  - Lambda関数は `getRdsConfig()` を通じてRDS接続情報を取得しますが、環境変数 `BILLING_RDS_SECRET_ARN` が設定されていない場合、BillingManagementStackがデプロイされません
- **影響**:
  - 現在、`process.env.BILLING_RDS_SECRET_ARN` が未設定の場合、プラン管理API全体がデプロイされません
- **対処方法**:
  - デプロイ前に `BILLING_RDS_SECRET_ARN` 環境変数を設定してください
  - または、開発環境用のモックRDS設定を用意してください

---

## 5. 推奨事項

### 優先度：高

1. **Lambda関数のディレクトリ構造を修正**
   - すべてのプラン管理Lambda関数を `packages/cdk/lambda/billing/admin/plan-management/` に移動
   - サブスクリプション管理Lambda関数も同様に `packages/cdk/lambda/billing/admin/subscription-management/` に移動
   - ファイル名を CDK コンストラクトが期待する名前に変更（特に `getPlanDetails.ts` → `getPlan.ts`）

2. **CDKスタックのデプロイテスト**
   - Lambda関数の移動後、CDKスタックが正常にデプロイできることを確認
   - 環境変数 `BILLING_RDS_SECRET_ARN` が正しく設定されていることを確認

### 優先度：中

3. **統合テストの実施**
   - フロントエンドからの実際のAPI呼び出しをテスト
   - 管理者権限の検証が正しく動作することを確認
   - エラーハンドリングが適切に機能することを確認

4. **監査ログの実装**
   - 仕様書に記載されている監査ログ機能がまだ実装されていません（`TODO` コメントあり）
   - プラン作成、ステータス変更などの操作を記録するロジックを追加

### 優先度：低

5. **仕様書の更新**
   - OpenFGAではなくCognito `custom:tenantAdmin` を使用している旨を仕様書に反映

6. **プラン変更履歴テーブルの実装**
   - 仕様書に記載されている `plan_change_history` テーブルの作成
   - ステータス変更時の履歴記録機能の実装

---

## 6. 確認できなかった項目

### Lambda関数の実装詳細
以下の実装については、今回の調査では詳細を確認できませんでした:
- プラン変更履歴の記録ロジック（`plan_change_history` テーブルへの書き込み）
- 監査ログの記録ロジック
- サブスクリプション統計情報の集計ロジック（`getPlanSubscriptions.ts`）の実装詳細

### データベーススキーマ
- RDSデータベースの実際のテーブル定義
- `plans` テーブル、`user_plan_applications` テーブル、`subscriptions` テーブルの実装状況

### VPC設定
- Lambda関数からRDSへのネットワーク接続が正しく設定されているか
- セキュリティグループの設定が適切か

### Subscription Management API
- Subscription Management APIのLambda関数が実際にどこに配置されているか
- 同様のパス不一致問題がないか

---

## 7. 次のステップ

1. **【即座に実施】Lambda関数のディレクトリ構造を修正**
   - 上記の推奨事項1に従って、ファイルを移動・リネーム

2. **【デプロイ前に実施】環境変数の設定**
   - `BILLING_RDS_SECRET_ARN` を設定
   - RDSインスタンスの作成と接続情報の確認

3. **【デプロイ後に実施】動作確認**
   - CDKスタックのデプロイ
   - API Gatewayエンドポイントの疎通確認
   - フロントエンドとの統合テスト

4. **【機能追加】監査ログとプラン変更履歴の実装**
   - 仕様書に記載されている機能を実装

---

## 付録: ファイルパス一覧

### フロントエンド
- API呼び出しフック: `/packages/web/src/hooks/usePlanApi.ts`
- プラン管理ページ: `/packages/web/src/pages/PlanManagementPage.tsx`
- プラン詳細ページ: `/packages/web/src/pages/PlanDetailPage.tsx`
- プラン作成ページ: `/packages/web/src/pages/PlanCreatePage.tsx`

### バックエンド - CDKコンストラクト
- プラン管理API: `/packages/cdk/lib/construct/api/plan-management.ts`
- サブスクリプション管理API: `/packages/cdk/lib/construct/api/subscription-management.ts`
- BillingManagementスタック: `/packages/cdk/lib/stacks/nested/billing-management-stack.ts`
- メインスタック: `/packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`

### バックエンド - Lambda関数（現在の配置）
- `/packages/cdk/lambda/billing/admin/listPlans.ts`
- `/packages/cdk/lambda/billing/admin/getPlanDetails.ts`
- `/packages/cdk/lambda/billing/admin/createPlan.ts`
- `/packages/cdk/lambda/billing/admin/updatePlanStatus.ts`
- `/packages/cdk/lambda/billing/admin/getPlanHistory.ts`
- `/packages/cdk/lambda/billing/admin/getPlanSubscriptions.ts`
- `/packages/cdk/lambda/billing/admin/checkPlanName.ts`

### バックエンド - ユーティリティ
- 管理者認証: `/packages/cdk/lambda/utils/adminAuth.ts`
- RDS設定: `/packages/cdk/lambda/utils/rdsConfig.ts`（想定）
- プランリポジトリ: `/packages/cdk/lambda/repositories/planRepository.ts`

### 仕様書
- API仕様: `/docs/課金・プランの仕様/管理者向け運用管理インターフェース/API/プラン管理API仕様.md`
- ページ仕様: `/docs/課金・プランの仕様/管理者向け運用管理インターフェース/ページ/プラン管理ページ.md`
