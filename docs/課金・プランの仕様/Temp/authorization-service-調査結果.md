# Authorization機構 調査結果

## 調査概要

### 調査対象
- `packages/cdk/lambda/authorization/` ディレクトリ配下のLambda関数（5関数）
- `packages/cdk/lib/construct/authorization-system.ts` CDK Construct
- `packages/cdk/lib/stacks/nested/billing-management-stack.ts` 課金管理スタック
- `packages/cdk/lib/construct/api/plan-management.ts` プラン管理API
- `packages/cdk/lib/construct/api/subscription-management.ts` サブスク管理API

### 調査結果サマリ
**Authorization機構は実装済み**だが、**統括責務との連携が未実装**。統括責務（Orchestration）自体がまだ実装されていない。

---

## 権限付与関数/エンドポイント

### 実装状況: **実装済み**

### ファイルパス
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/grantPermission.ts`
- CDK定義: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts` (L222-L235)

### シグネチャ

**入力パラメータ (GrantPermissionRequest)**:
```typescript
{
  tenantId: string;              // テナントID
  userId: string;                // ユーザID
  grantId: string;               // 権限付与ID（呼び出し元が生成するUUID）
  features: Array<{              // 付与する機能のリスト
    featureId: string;           // 機能ID（例: "feature-model-a"）
    limitType: 'unlimited' | 'daily' | 'monthly';
    limitCount?: number;         // limitTypeが'unlimited'以外の場合に必須
  }>;
  sourceType: string;            // 付与元のタイプ（例: "subscription", "trial", "campaign", "manual"）
  sourceId: string;              // 付与元のID（サブスクリプションID、キャンペーンIDなど）
}
```

**出力パラメータ (GrantPermissionResponse)**:
```typescript
{
  success: true;
  grantId: string;
  grantedAt: string;  // ISO8601形式
}
```

### 実装内容
1. **OpenFGA統合**: テナントロールをAssumeRoleして、OpenFGA API Gatewayに署名付きリクエストを送信し、`user:${userId}` → `can_access` → `feature:${featureId}` の関係性を登録
2. **DynamoDB UsageCounter**: 回数制限がある機能について、利用回数カウンター情報をDynamoDBに作成
3. **DynamoDB PermissionGrant**: 権限付与履歴をDynamoDBに記録（grantId、userId、features、status、sourceType、sourceId、grantedAt）
4. **ロールバック機能**: DynamoDB書き込み失敗時、OpenFGAの関係性を削除してロールバック

### 問題点

#### 1. **統括責務からの呼び出し未実装**
- 技術実装詳細.mdには「ステップ6: 権限付与（planManagementClientが内部で呼び出す想定、または統括責務から直接呼び出す）」と記載
- **現状**: `applyPlanToUser.ts` (plan-management) は権限付与を呼び出していない（RDB `user_plan_applications` テーブルに記録するのみ）
- **必須修正**: 統括責務の購入フロー、プラン変更フローから `grantPermission` Lambda関数を呼び出す必要がある

#### 2. **Lambda Invoke権限の未付与**
- **現状**: BillingManagementStackには統括責務（Orchestration）が存在しない
- **必須修正**: 統括責務のLambda関数から `grantPermissionFunction` を呼び出すIAM権限を付与する必要がある

#### 3. **grantIdの生成責任が不明確**
- 技術実装詳細.mdでは「付与には一意のIDが割り当てられる（後でまとめて削除するため）」と記載
- **現状**: `grantPermission` の入力パラメータとして `grantId` を要求（呼び出し元がUUID生成）
- **問題**: 統括責務側で `grantId` を生成して渡す必要があるが、その仕様が明確でない
- **推奨**: `application_id` (プラン適用ID) を `grantId` として利用すると、後で剥奪時に対応付けが容易

---

## 権限剥奪関数/エンドポイント

### 実装状況: **実装済み**

### ファイルパス
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/revokePermission.ts`
- CDK定義: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts` (L237-L251)

### シグネチャ

**入力パラメータ (RevokePermissionRequest)**:
```typescript
{
  tenantId: string;  // テナントID
  grantId: string;   // 権限付与ID
}
```

**出力パラメータ (RevokePermissionResponse)**:
```typescript
{
  success: true;
  grantId: string;
  revokedAt: string;  // ISO8601形式
}
```

### 実装内容
1. **DynamoDBから権限付与履歴を取得**: `grantId` で権限付与履歴を検索
2. **OpenFGA関係性削除**: テナントロールをAssumeRoleして、OpenFGA API Gatewayから `user:${userId}` → `can_access` → `feature:${featureId}` の関係性を削除
3. **DynamoDB UsageCounter削除**: `grantId` で検索した利用回数カウンター情報を一括削除
4. **DynamoDB PermissionGrant更新**: 権限付与履歴のstatusを `revoked` に更新、`revokedAt` を記録
5. **冪等性保証**: 既に剥奪済み（`status: 'revoked'`）の場合も成功を返す

### 問題点

#### 1. **統括責務からの呼び出し未実装**
- **現状**: `terminatePlanApplication.ts` (plan-management) は権限剥奪を呼び出していない（RDB `user_plan_applications.application_status` を `expired` に変更するのみ）
- **必須修正**: 統括責務の解約フロー、プラン変更フローから `revokePermission` Lambda関数を呼び出す必要がある

#### 2. **Lambda Invoke権限の未付与**
- **必須修正**: 統括責務のLambda関数から `revokePermissionFunction` を呼び出すIAM権限を付与する必要がある

#### 3. **grantIdの逆引きが必要**
- **問題**: `terminatePlanApplication` の入力パラメータには `grantId` が含まれていない
- **現状**: `terminatePlanApplication` は `applicationSourceId` (サブスクリプションID) から `user_plan_applications` を検索して `application_id` を取得
- **必須修正**: 統括責務は `application_id` を `grantId` として使用し、`revokePermission` に渡す必要がある

---

## OpenFGA統合

### 実装状況: **実装済み**

### 統合箇所
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/grantPermission.ts` (L62-L118, L179-L209)
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/revokePermission.ts` (L38-L93, L176-L206)

### 統合内容
1. **テナントロール AssumeRole**: テナント情報からロールARNを取得し、STSでAssumeRole
2. **署名付きリクエスト**: AWS Signature V4で署名付きHTTPリクエストを作成
3. **OpenFGA API Gateway呼び出し**: `POST /stores/{storeId}/write` エンドポイントに関係性の書き込み/削除リクエスト送信
4. **関係性のフォーマット**:
   - `user`: `user:${userId}`
   - `relation`: `can_access`
   - `object`: `feature:${featureId}`

### 問題点
**なし**（OpenFGA統合は適切に実装済み）

---

## 回数制限カウント機構

### 実装状況: **実装済み**

### DynamoDBテーブル
- **テーブル名**: `UsageCounter-{environment}-tenant-{sanitizedTenantId}`
- **CDK定義**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts` (L129-L169)
- **パーティションキー**: `userId` (String)
- **ソートキー**: `featureIdPeriod` (String) - 例: `"feature-model-b#daily"`
- **GSI 1**: `grantId-index` (権限付与IDで検索、剥奪時に使用)
- **GSI 2**: `periodType-nextResetTime-index` (期間タイプとリセット日時で検索、バッチリセット用)
- **課金モード**: オンデマンド（PAY_PER_REQUEST）

### カウンター操作関数

#### 1. **カウンター作成** (grantPermission内で実施)
- ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/grantPermission.ts` (L239-L262)
- Repository: `UsageCountRepository.create()` (L30-L37)
- 処理: `limitType` が `'unlimited'` 以外の機能について、`currentCount: 0`, `limitCount`, `nextResetTime` を記録

#### 2. **カウンター加算** (incrementUsageCount Lambda関数)
- ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/incrementUsageCount.ts`
- Repository: `UsageCountRepository.increment()` (L65-L97)
- 処理: DynamoDB `UpdateItem` の `ADD` オペレーションでアトミックに加算

#### 3. **カウンターリセット** (resetUsageCount Lambda関数)
- ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/resetUsageCount.ts`
- Repository: `UsageCountRepository.reset()` (L151-L174)
- スケジュール:
  - **Daily**: 毎日 00:00 UTC (EventBridge Rule: L378-L397)
  - **Monthly**: 毎月1日 00:00 UTC (EventBridge Rule: L400-L423)

#### 4. **カウンター削除** (revokePermission内で実施)
- ファイル: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/revokePermission.ts` (L208-L222)
- Repository: `UsageCountRepository.batchDelete()` (L179-L209)
- 処理: `grantId` で検索したカウンター情報を一括削除（最大25件ずつバッチ処理）

### 問題点
**なし**（回数制限カウント機構は適切に実装済み）

---

## 統括責務が動作する上で必須の修正事項

### 1. **統括責務（Orchestration）の実装**
**必須度: 最高**

- **現状**: `packages/cdk/lib/construct/api/orchestration.ts` が存在しない
- **技術実装詳細.md**: L9で定義されているが、未実装
- **必須修正内容**:
  - OrchestrationApi Constructの作成
  - 4つのフロー統括Lambda関数の実装（purchaseFlow, planChangeFlow, cancellationFlow, webhookEventFlow）
  - DynamoDBテーブルの定義（フロー実行履歴、ステップ実行履歴）
  - EventBridgeルールの定義（Webhookイベント起動）

### 2. **統括責務から権限付与・剥奪の呼び出し実装**
**必須度: 最高**

#### 2-1. 購入フロー（purchaseFlow.ts）
- **ステップ5**: `planManagementClient.applyPlanToUser` を呼び出し、`application_id` を取得
- **ステップ6**: `grantId = application_id` として、`authorizationClient.grantPermission` を呼び出す
  - 入力: `tenantId`, `userId`, `grantId`, `features` (プラン情報から取得), `sourceType: 'subscription'`, `sourceId: subscription_id`

#### 2-2. プラン変更フロー（planChangeFlow.ts）
- **ステップ4**: `authorizationClient.revokePermission` を呼び出して古いプランの権限剥奪
  - 入力: `tenantId`, `grantId` (古い `application_id`)
- **ステップ5**: `planManagementClient.applyPlanToUser` を呼び出し、新しい `application_id` を取得
- **ステップ6**: `authorizationClient.grantPermission` を呼び出して新しいプランの権限付与
  - 入力: `tenantId`, `userId`, `grantId` (新しい `application_id`), `features`, `sourceType: 'subscription'`, `sourceId: subscription_id`

#### 2-3. 解約フロー（cancellationFlow.ts）
- **ステップ3（即時解約）**: `authorizationClient.revokePermission` を呼び出し
  - 入力: `tenantId`, `grantId` (`application_id`)
- **ステップ4（即時解約）**: `planManagementClient.terminatePlanApplication` を呼び出し
- **ステップ3（期限終了時解約）**: 権限剥奪は実施せず、`planManagementClient.updatePlanApplicationStatus` で `scheduled_termination` に更新
- **（後日バッチ処理）**: 期限到達時に `authorizationClient.revokePermission` を呼び出し、その後 `planManagementClient.terminatePlanApplication` を呼び出し

#### 2-4. Webhookイベント処理フロー（webhookEventFlow.ts）
- **refund.created（返金）の場合のステップ2**: `authorizationClient.revokePermission` を呼び出し
  - 入力: `tenantId`, `grantId` (`application_id`)

### 3. **統括責務のLambda関数にIAM権限付与**
**必須度: 最高**

- **必須権限**:
  - `lambda:InvokeFunction` for `grantPermissionFunction.functionArn`
  - `lambda:InvokeFunction` for `revokePermissionFunction.functionArn`
  - `lambda:InvokeFunction` for `checkPermissionFunction.functionArn` (必要に応じて)

- **実装箇所**: `packages/cdk/lib/construct/api/orchestration.ts` (OrchestrationConstruct内)

### 4. **BillingManagementStackへのOrchestration追加**
**必須度: 最高**

- **ファイル**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/nested/billing-management-stack.ts`
- **現状**: L205でコメント「Note: Orchestration API (統括処理) will be added later as needed」と記載
- **必須修正内容**:
  - OrchestrationConstructのインスタンス化
  - `planManagementApi.internalFunctions` と `subscriptionManagementApi.internalFunctions` を引数として渡す
  - **Authorization関数へのアクセス権限**: OrchestrationConstructに `authorizationFunctions` として `grantPermissionFunction`, `revokePermissionFunction` を渡す必要がある

### 5. **authorizationClientモジュールの実装**
**必須度: 最高**

- **ファイルパス**: `packages/cdk/lambda/billing/orchestration/clients/authorizationClient.ts` (新規作成)
- **必須メソッド**:
  - `grantPermission(tenantId, userId, grantId, features, sourceType, sourceId)`: 権限付与Lambda関数を同期呼び出し
  - `revokePermission(tenantId, grantId)`: 権限剥奪Lambda関数を同期呼び出し
  - `checkPermission(tenantId, userId, featureId)`: 権限チェックLambda関数を同期呼び出し（必要に応じて）
- **実装方式**: 技術実装詳細.md L784-L800のパターンを踏襲（AWS SDK v3の `LambdaClient`, `InvokeCommand`）

### 6. **プラン情報から機能リストへの変換ロジック**
**必須度: 高**

- **問題**: 統括責務は「このプランにはどの機能が含まれ、それぞれ何回まで使えるか」の情報を取得する必要がある
- **現状**: `planManagementClient.applyPlanToUser` は `planId` を受け取るが、プラン詳細（含まれる機能リスト）を返さない
- **必須修正内容**:
  - **方法1**: `planManagementClient.getPlan(planId)` を呼び出して、プランに含まれる機能リスト (`features: Array<{featureId, limitType, limitCount}>`) を取得
  - **方法2**: 統括責務の入力パラメータに `features` を含める（呼び出し元が事前にプラン情報を取得）
- **推奨**: 方法1（統括責務内でプラン情報を取得して変換）

### 7. **RDBスキーマへの対応付け保存（任意）**
**必須度: 低（推奨）**

- **問題**: `user_plan_applications.application_id` と `PermissionGrant.grantId` の対応付けがRDB側に記録されていない
- **推奨修正**: `user_plan_applications` テーブルに `grant_id` カラムを追加し、`application_id` と同じ値を記録
  - メリット: RDBクエリだけで「このユーザーのこのプラン適用に紐づく権限付与ID」を特定可能
  - トラブルシューティング時に有用

---

## 補足事項

### 1. Authorization機構の設計品質
- OpenFGA統合、回数制限カウント、DynamoDB設計、EventBridgeスケジューラなど、すべて適切に実装されている
- ロールバック処理、冪等性保証、エラーハンドリングも適切
- IAM権限、テナントロール AssumeRole、署名付きリクエストも正しく実装

### 2. 統括責務（Orchestration）の実装優先度
- **技術実装詳細.md**: L1-L1111で詳細な設計が記載されているが、コード実装は0%
- **Authorization機構との連携**: 統括責務が実装されない限り、Authorization機構は呼び出されない
- **実装優先順位**:
  1. OrchestrationConstruct + 購入フロー統括Lambda関数
  2. authorizationClientモジュール
  3. 購入フロー内で権限付与呼び出し
  4. プラン変更フロー、解約フロー、Webhookイベント処理フロー（順次実装）

### 3. プラン情報と機能リストの対応付け
- **現状不明**: RDBスキーマに「プランに含まれる機能リスト」がどのように格納されているか調査が必要
- **推測**: `plans` テーブルに `features` (JSON型) カラムがあると想定
- **必須確認**: `packages/cdk/lambda/repositories/planRepository.ts` で `features` の取得方法を確認

### 4. テストの実施
- Authorization機構の各Lambda関数は単体で動作確認可能（手動Invokeテスト）
- 統括責務実装後、エンドツーエンドテストが必要:
  - 購入フロー → OpenFGA関係性が登録されているか確認
  - 解約フロー → OpenFGA関係性が削除されているか確認
  - プラン変更フロー → 古い関係性削除、新しい関係性登録を確認

### 5. ドキュメントの一貫性
- 技術実装詳細.mdは詳細に記載されており、実装の指針として活用可能
- ただし、実装が0%のため、実際のコード実装時に詳細な設計変更が必要になる可能性がある
