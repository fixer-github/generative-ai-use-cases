# サブスクリプション管理API調査結果

## 調査日時
2025-11-12

## 調査対象
管理者向けサブスクリプション管理APIの実装状況について、以下の観点から調査を実施しました：
1. フロントエンド側が期待するAPI呼び出しと、実装されたAPIのI/O（入出力）の一致性
2. CDKでのAPI公開設定（フロントエンドから叩けるか）
3. 管理者のみアクセス可能な制限が設定されているか

---

## 1. フロントエンドとバックエンドのI/O一致性

### GET /admin/billing/subscriptions/statistics - サブスクリプション統計取得

#### フロントエンド期待値
- **リクエスト**: クエリパラメータ `period` (任意: `last_7_days`, `last_30_days`, `last_90_days`, `last_1_year`)
- **レスポンス**:
  - `summary`: 有効な契約数、検証保留中の数、支払い失敗中の数、今月の新規/解約数、前月比較
  - `breakdown_by_platform`: プラットフォーム別の内訳（stripe/apple/google）
  - `breakdown_by_plan`: プラン別の内訳
  - `breakdown_by_status`: ステータス別の内訳
  - `trend`: 期間別推移データ

#### バックエンド実装
- **実装ファイル**: `/packages/cdk/lambda/billing/admin/subscriptions/getStatistics.ts`
- **実装状況**:
  - ✅ クエリパラメータ `period` の検証実装済み
  - ✅ レスポンス形式は仕様と一致
  - ⚠️ 部分的に未実装の箇所あり（TODOコメント）
    - 今月の新規契約数・解約数は仮実装（値が0固定）
    - プラン別のステータス内訳が未実装
    - トレンドデータ（`data_points`）が空配列

#### 一致性判定
⚠️ **要確認** - 基本的な構造は一致しているが、一部データが未実装

#### 備考
- 統計情報の取得自体は動作するが、詳細な分析に必要な一部データが不足
- `SubscriptionRepository.getStatistics()` メソッドが実装されている前提

---

### GET /admin/billing/subscriptions - サブスクリプション一覧取得

#### フロントエンド期待値
- **リクエスト**:
  - ページネーション: `page`, `limit`
  - ソート: `sort_by`, `sort_order`
  - フィルタ: `subscription_id`, `user_id`, `user_name`, `platform_type`, `status`, `plan_id`, 日付範囲など
- **レスポンス**:
  - `subscriptions`: サブスクリプション一覧（配列）
  - `pagination`: ページネーション情報

#### バックエンド実装
- **実装ファイル**: `/packages/cdk/lambda/billing/admin/subscriptions/listSubscriptions.ts`
- **実装状況**:
  - ✅ 全てのクエリパラメータの検証実装済み
  - ✅ パラメータバリデーションが適切
  - ✅ ページネーション処理実装済み
  - ⚠️ ユーザ名が `user_id` をそのまま返している（TODOコメント）

#### 一致性判定
✅ **一致** - 主要な機能は仕様通り実装済み（ユーザ名取得を除く）

#### 備考
- `SubscriptionRepository.findAllForAdmin()` メソッドが実装されている前提
- ユーザ情報テーブルからの取得が未実装だが、動作に大きな支障はない

---

### GET /admin/billing/subscriptions/{subscription_id} - サブスクリプション基本情報取得

#### フロントエンド期待値
- **リクエスト**: パスパラメータ `subscription_id`
- **レスポンス**:
  - 基本情報（ID、ステータス、作成日時など）
  - `user`: ユーザ情報
  - `plan`: プラン情報
  - `period`: 期間と更新情報

#### バックエンド実装
- **実装ファイル**: `/packages/cdk/lambda/billing/admin/subscriptions/getSubscriptionDetails.ts`
- **実装状況**:
  - ✅ パスパラメータの検証実装済み
  - ✅ レスポンス形式は仕様と一致
  - ⚠️ 部分的に未実装の箇所あり
    - ユーザ情報が簡易実装（ユーザIDをそのまま使用）
    - 更新回数が固定値0
    - 次回請求金額が固定値

#### 一致性判定
⚠️ **要確認** - 基本構造は一致しているが、一部データが仮実装

#### 備考
- `SubscriptionRepository.findByIdWithDetails()` メソッドが実装されている前提

---

### POST /admin/billing/subscriptions/{subscription_id}/approve - サブスクリプション承認

#### フロントエンド期待値
- **リクエスト**:
  - パスパラメータ `subscription_id`
  - リクエストボディ: `note` (任意)
- **レスポンス**:
  - `subscription_id`, `previous_status`, `new_status`
  - `approved_at`, `approved_by`
  - `user_plan_application_id`, `notification_sent`

#### バックエンド実装
- **実装ファイル**: `/packages/cdk/lambda/billing/admin/subscriptions/approveSubscription.ts`
- **実装状況**:
  - ✅ パスパラメータとボディの検証実装済み
  - ✅ ステータスチェック実装済み（`pending_verification` のみ承認可能）
  - ✅ サブスクリプションステータス更新実装済み
  - ✅ ユーザプラン適用レコード作成実装済み
  - ❌ 以下が未実装（TODOコメント）
    - OpenFGAへの権限登録
    - 利用回数カウンターの初期化
    - ユーザへの通知送信
    - 監査ログへの記録
    - ステータス変更履歴の記録

#### 一致性判定
⚠️ **要確認** - 基本処理は実装済みだが、重要な処理が未実装

#### 備考
- レスポンスの `notification_sent` が常に `false`
- 実際の運用では、未実装部分の完成が必須

---

### POST /admin/billing/subscriptions/{subscription_id}/reject - サブスクリプション却下

#### フロントエンド期待値
- **リクエスト**:
  - パスパラメータ `subscription_id`
  - リクエストボディ: `rejection_reason` (必須), `rejection_details` (任意)
- **レスポンス**:
  - `subscription_id`, `previous_status`, `new_status`
  - `rejected_at`, `rejected_by`
  - `rejection_reason`, `rejection_details`, `notification_sent`

#### バックエンド実装
- **実装ファイル**: `/packages/cdk/lambda/billing/admin/subscriptions/rejectSubscription.ts`
- **実装状況**:
  - ✅ パスパラメータとボディの検証実装済み
  - ✅ `rejection_reason` のバリデーション実装済み（4つの選択肢）
  - ✅ ステータスチェック実装済み（`pending_verification` のみ却下可能）
  - ✅ サブスクリプションステータス更新実装済み
  - ❌ 以下が未実装（TODOコメント）
    - 却下理由と管理者情報の記録（履歴テーブル）
    - ユーザへの通知送信
    - 監査ログへの記録

#### 一致性判定
⚠️ **要確認** - 基本処理は実装済みだが、重要な処理が未実装

#### 備考
- レスポンスの `notification_sent` が常に `false`

---

### その他のエンドポイント

#### 仕様書に記載されているが実装が見つからないエンドポイント
以下のエンドポイントは、仕様書に記載されているが、Lambda実装ファイルが見つかりませんでした：

1. ❌ `GET /admin/billing/subscriptions/{subscription_id}/status-history` - ステータス履歴取得
2. ❌ `GET /admin/billing/subscriptions/{subscription_id}/payment-history` - 支払い・請求履歴取得
3. ❌ `GET /admin/billing/subscriptions/{subscription_id}/receipt` - レシート情報取得
4. ❌ `GET /admin/billing/subscriptions/{subscription_id}/operation-history` - 操作履歴取得
5. ❌ `POST /admin/billing/subscriptions/batch-process` - 一括承認/却下
6. ❌ `POST /admin/billing/subscriptions/{subscription_id}/retry-verification` - レシート再検証
7. ❌ `POST /admin/billing/subscriptions/{subscription_id}/sync` - プラットフォーム同期

---

## 2. CDKでのAPI公開設定

### API Gatewayへの登録状況

#### 実装ファイル
- `/packages/cdk/lib/construct/api/subscription-management.ts`
- `/packages/cdk/lib/stacks/nested/billing-management-stack.ts`
- `/packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`

#### エンドポイント定義
✅ **適切** - CDKで以下のエンドポイントが定義されています：

1. ✅ `GET /admin/billing/subscriptions/statistics` - 統計情報取得
2. ✅ `GET /admin/billing/subscriptions` - 一覧取得
3. ✅ `GET /admin/billing/subscriptions/{subscription_id}` - 詳細取得
4. ✅ `POST /admin/billing/subscriptions/{subscription_id}/approve` - 承認
5. ✅ `POST /admin/billing/subscriptions/{subscription_id}/reject` - 却下
6. ✅ `POST /admin/billing/subscriptions/batch-process` - 一括処理
7. ✅ `POST /admin/billing/subscriptions/{subscription_id}/retry-verification` - 再検証
8. ✅ `POST /admin/billing/subscriptions/{subscription_id}/sync` - プラットフォーム同期

#### 判定
✅ **適切** - 主要なエンドポイントはAPI Gatewayに登録済み

#### 重大な問題
❌ **Lambda実装ファイルのパス不一致**

CDKでは以下のパスを参照していますが、実際のファイルは存在しません：
```typescript
entry: './lambda/billing/admin/subscription-management/getStatistics.ts'
```

実際のファイルは以下のパスに存在します：
```
./lambda/billing/admin/subscriptions/getStatistics.ts
```

**影響**:
- CDKデプロイ時にエラーが発生する可能性が高い
- または、古いビルドされたLambdaが使用されている可能性

**修正が必要な箇所**:
`/packages/cdk/lib/construct/api/subscription-management.ts` の109行目以降、全てのLambda関数のentryパスを `subscription-management` から `subscriptions` に変更する必要があります。

---

### CORS設定

#### 設定内容
✅ CORS設定が実装されています：
- Lambda関数内で `CORS_HEADERS` を定義し、全てのレスポンスに含めています
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

#### 判定
✅ **適切**

---

### HTTPメソッド設定

#### 設定内容
各エンドポイントに適切なHTTPメソッドが設定されています：
- GET: 統計、一覧、詳細取得
- POST: 承認、却下、一括処理、再検証、同期

#### 判定
✅ **適切**

---

### スタックへの統合状況

#### 実装状況
✅ `BillingManagementStack` が main スタック（`GenerativeAiUseCasesStack`）に統合されています：

- **ファイル**: `/packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`
- **行番号**: 288-306行目
- **条件**: 環境変数 `BILLING_RDS_SECRET_ARN` が設定されている場合のみ有効

#### 判定
✅ **適切** - ただし環境変数が設定されていない場合はデプロイされない

#### 備考
- RDSシークレットARNが環境変数として設定されている必要がある
- テナントマネージャーが渡されているが、現在のコードでは使用されていない

---

## 3. 管理者権限制限

### OpenFGA権限チェック実装

#### 実装ファイル
- `/packages/cdk/lambda/utils/adminAuth.ts`

#### 実装方法
✅ **実装済み** - ミドルウェアパターン

全てのサブスクリプション管理APIのLambda関数で以下の処理が実装されています：

```typescript
// 管理者権限の検証
const adminResult = await verifyAdminAccess(event);
if (!isAdminContext(adminResult)) {
  return adminResult; // 403 Forbiddenなどのエラーレスポンス
}
```

#### verifyAdminAccessの処理内容

1. **JWTトークンの抽出と検証**:
   - Authorizationヘッダーからトークンを取得
   - トークンが存在しない場合は401エラー

2. **リアルタイムロールチェック**:
   - `verifyTokenWithRoleCheck()` でトークンを検証
   - Cognitoから現在の管理者ステータスを取得
   - トークンのクレームだけでなく、実際のCognitoユーザー属性を確認

3. **テナントIDの確認**:
   - トークンから `custom:tenant_id` を取得
   - テナントIDが存在しない場合は400エラー

4. **管理者権限の検証**:
   - 現在のユーザーが管理者でない場合は403エラー
   - トークンと実際の権限が異なる場合は409エラー（ロール変更検知）

#### 判定
✅ **実装済み**

#### 備考
- OpenFGAではなく、Cognitoのカスタム属性 `custom:tenantAdmin` で管理者権限を判定
- 仕様書では「OpenFGAによる管理者権限の検証」と記載されているが、実装ではCognitoを使用
- これは問題ではないが、仕様書と実装の乖離として記録

---

### 403エラーハンドリング

#### 実装状況
✅ **適切** - 各Lambda関数で適切にエラーハンドリングされています

エラーレスポンスの形式：
```json
{
  "statusCode": 403,
  "headers": {
    "Access-Control-Allow-Origin": "*",
    ...
  },
  "body": {
    "message": "Access denied. Admin privileges required."
  }
}
```

#### 特徴
- 403エラー: 管理者権限がない場合
- 409エラー: トークンと実際の権限が異なる場合（ロール変更検知）
- エラーメッセージが詳細で、ユーザーフレンドリー

#### 判定
✅ **適切**

---

## 4. 総合評価

### 問題点・懸念事項

#### 重大な問題
1. **❌ Lambda実装ファイルのパス不一致**
   - CDKが参照するパス: `./lambda/billing/admin/subscription-management/*.ts`
   - 実際のファイルパス: `./lambda/billing/admin/subscriptions/*.ts`
   - **影響**: CDKデプロイが失敗するか、古いビルドが使用される可能性
   - **修正方法**: CDKファイル内の全entryパスを修正

2. **❌ 主要機能の未実装**
   - 以下のエンドポイントのLambda実装が存在しない：
     - ステータス履歴取得
     - 支払い・請求履歴取得
     - レシート情報取得
     - 操作履歴取得
     - 一括承認/却下
     - レシート再検証
     - プラットフォーム同期

3. **❌ 承認/却下処理の重要機能が未実装**
   - OpenFGAへの権限登録
   - 利用回数カウンターの初期化
   - ユーザへの通知送信
   - 監査ログへの記録
   - ステータス変更履歴の記録

#### 中程度の問題
4. **⚠️ 統計情報の一部データが未実装**
   - 今月の新規契約数・解約数（0固定）
   - プラン別のステータス内訳
   - トレンドデータ

5. **⚠️ ユーザ情報の取得が簡易実装**
   - ユーザ名がユーザIDをそのまま返している
   - ユーザ情報テーブルからの取得が必要

6. **⚠️ 環境変数への依存**
   - `BILLING_RDS_SECRET_ARN` が設定されていない場合、API自体がデプロイされない

#### 軽微な問題
7. **⚠️ 仕様書と実装の乖離**
   - 仕様書: OpenFGAで管理者権限チェック
   - 実装: Cognitoカスタム属性で管理者権限チェック
   - （動作に問題はないが、ドキュメント更新が必要）

---

### 推奨事項

#### 最優先（P0）
1. **Lambda実装ファイルのパス修正**
   - `/packages/cdk/lib/construct/api/subscription-management.ts` の全entryパスを修正
   - `subscription-management` → `subscriptions`
   - または、Lambda実装ファイルを移動

2. **承認/却下処理の完成**
   - OpenFGAへの権限登録実装
   - 利用回数カウンター初期化実装
   - 通知送信機能の実装
   - 監査ログ記録の実装
   - ステータス変更履歴記録の実装

#### 高優先度（P1）
3. **未実装エンドポイントのLambda作成**
   - 特に以下は運用に必須：
     - 一括承認/却下
     - レシート再検証
     - ステータス履歴取得

4. **統計情報の完全実装**
   - 今月の新規/解約数の計算実装
   - プラン別のステータス内訳実装
   - トレンドデータの実装

#### 中優先度（P2）
5. **ユーザ情報取得の改善**
   - ユーザ情報テーブルからの実名取得
   - メールアドレスの正確な取得

6. **仕様書の更新**
   - OpenFGA → Cognito への記載修正
   - 未実装機能の明記

#### 低優先度（P3）
7. **エラーメッセージの国際化対応**
   - 現在は英語のみ
   - 日本語エラーメッセージの追加

---

## 5. 確認できなかった項目

### フロントエンド実装
- **理由**: サブスクリプション管理ページのフロントエンド実装ファイルが見つからなかった
- **確認した場所**:
  - `/packages/web/src/pages/`
  - `/packages/web/src/components/`
- **発見**: AdminPortal.tsx は存在するが、ユーザ管理のみでサブスクリプション管理機能は含まれていない
- **推測**: フロントエンドの実装がまだ開始されていない可能性が高い

### RDSデータベーススキーマ
- **理由**: データベース設計ドキュメントやマイグレーションファイルが調査範囲外
- **確認が必要**:
  - サブスクリプションテーブルの実際のスキーマ
  - ユーザプラン適用テーブルの存在
  - 履歴テーブルの設計

### 環境変数の設定状況
- **理由**: 実行環境へのアクセスがない
- **確認が必要**: `BILLING_RDS_SECRET_ARN` が実際に設定されているか

---

## 6. 結論

### 現在の実装状況
- **基本的なAPI構造**: ✅ 整っている
- **管理者権限チェック**: ✅ 適切に実装されている
- **CDK設定**: ⚠️ パス不一致の問題あり
- **I/O一致性**: ⚠️ 部分的に実装済み、重要な機能が未実装
- **フロントエンド**: ❌ 未実装

### 運用可能性の評価
現時点では、以下の理由により**運用開始は困難**です：

1. Lambda実装ファイルのパス不一致により、デプロイが成功しない可能性が高い
2. 承認/却下の重要な処理（権限登録、通知送信、監査ログ）が未実装
3. 運用に必須のエンドポイント（一括処理、再検証など）が未実装
4. フロントエンドが未実装

### 最低限の運用開始に必要な作業
1. Lambda実装ファイルのパス修正（1-2時間）
2. 承認/却下処理の完成（5-10時間）
3. 一括承認/却下、レシート再検証の実装（10-15時間）
4. フロントエンドの実装（20-40時間）

**合計見積もり**: 36-67時間（約5-9営業日）

---

## 調査実施者
Claude Code (AI Agent)

## 調査方法
- ソースコードの静的解析
- 仕様書との照合
- ファイル構造の確認
