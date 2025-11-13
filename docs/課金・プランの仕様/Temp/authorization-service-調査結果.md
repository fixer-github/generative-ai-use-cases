# Authorization Service実装調査結果

## 1. 実装状況の概要

- **OpenFGAの実装**: ✅ 実装済み
- **カウント機構**: ✅ 実装済み
- **権限付与・剥奪API**: ✅ 実装済み
- **Lambda-to-Lambda呼び出し対応**: ❌ 未実装（API Gateway + IAM認証のみ）

## 2. 実装されている機能の詳細

### 2.1 DynamoDBテーブル

#### UsageCounter テーブル
- **目的**: 利用回数カウント情報の管理
- **パーティションキー**: `userId`
- **ソートキー**: `featureIdPeriod` (例: `feature-model-b#daily`)
- **GSI**:
  - `grantId-index`: 権限付与IDで検索
  - `periodType-nextResetTime-index`: リセット処理用

**データ構造**:
```typescript
{
  userId: string;
  featureIdPeriod: string; // 機能ID#期間タイプ
  featureId: string;
  periodType: 'daily' | 'monthly';
  currentCount: number;
  limitCount: number;
  nextResetTime: number; // Unixタイムスタンプ
  grantId: string;
  createdAt: number;
  updatedAt: number;
}
```

#### PermissionGrant テーブル
- **目的**: 権限付与履歴の管理
- **パーティションキー**: `grantId`
- **GSI**: `userId-status-index`（ユーザーID+状態で検索）

**データ構造**:
```typescript
{
  grantId: string;
  userId: string;
  features: Array<{
    featureId: string;
    limitType: 'unlimited' | 'daily' | 'monthly';
    limitCount?: number;
  }>;
  status: 'active' | 'revoked';
  sourceType: string; // "subscription", "trial", "campaign", "manual"
  sourceId: string; // サブスクリプションIDなど
  grantedAt: number;
  revokedAt?: number;
}
```

### 2.2 Lambda関数

#### grantPermission.ts
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/grantPermission.ts`

**責務**:
1. OpenFGAにfeatureアクセス権限を登録
2. DynamoDBにカウンター情報を作成（回数制限がある場合）
3. 権限付与履歴をDynamoDBに記録

**入力**:
```typescript
{
  tenantId: string;
  userId: string;
  grantId: string; // UUID（呼び出し元が生成）
  features: Array<{
    featureId: string;
    limitType: 'unlimited' | 'daily' | 'monthly';
    limitCount?: number;
  }>;
  sourceType: string;
  sourceId: string;
}
```

**処理フロー**:
1. バリデーション
2. テナント情報の取得
3. テナントロールをAssumeRole
4. OpenFGAに権限を登録（tupleを書き込み）
5. DynamoDBにカウンター情報を作成
6. DynamoDB書き込み失敗時はOpenFGAをロールバック

**OpenFGA連携**:
- Tuple形式: `user:${userId}` - `can_access` - `feature:${featureId}`
- API Gateway経由でSigV4署名付きリクエスト

#### revokePermission.ts
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/revokePermission.ts`

**責務**:
1. OpenFGAから権限を削除
2. DynamoDBからカウンター情報を削除
3. 権限付与履歴の状態を'revoked'に更新

**入力**:
```typescript
{
  tenantId: string;
  grantId: string;
}
```

**処理フロー**:
1. DynamoDBから権限付与情報を取得
2. 既にrevokedの場合は冪等性を保証（成功を返す）
3. OpenFGAからtupleを削除
4. DynamoDBからカウンター情報を削除
5. 権限付与履歴を更新

#### checkPermission.ts
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/checkPermission.ts`

**責務**:
1. OpenFGAに権限の有無を問い合わせ
2. DynamoDBに利用回数の残数を問い合わせ
3. 両方OKなら許可、どちらかNGなら拒否

**入力**:
```typescript
{
  tenantId: string;
  userId: string;
  featureId: string;
}
```

**出力**:
```typescript
{
  allowed: boolean;
  reason?: 'no_permission' | 'quota_exceeded';
  usage?: {
    daily?: { current: number; limit: number; remaining: number; };
    monthly?: { current: number; limit: number; remaining: number; };
  };
}
```

**処理フロー**:
1. OpenFGAで権限チェック
2. 権限なし → 拒否
3. 権限あり → DynamoDBで日次・月次カウンターをチェック
4. カウンター超過 → 拒否（quota_exceeded）
5. すべてOK → 許可

#### incrementUsageCount.ts
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/incrementUsageCount.ts`

**責務**: DynamoDBのカウンターをアトミックに+1

**入力**:
```typescript
{
  tenantId: string;
  userId: string;
  featureId: string;
  periodType: 'daily' | 'monthly';
}
```

**処理**: DynamoDB UpdateItemでcurrentCountをADD演算

#### resetUsageCount.ts
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/resetUsageCount.ts`

**責務**: 全テナントのカウンターを定期的にリセット

**入力**:
```typescript
{
  periodType: 'daily' | 'monthly';
}
```

**処理フロー**:
1. 全テナントのリストを取得
2. 各テナントのDynamoDBから期限切れカウンターを検索
3. カウンターをリセット（currentCount=0、nextResetTime更新）

**EventBridge Scheduler**:
- 日次リセット: 毎日00:00 UTC
- 月次リセット: 毎月1日00:00 UTC

### 2.3 リポジトリ実装

#### UsageCountRepository
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/repositories/usageCountRepository.ts`

**メソッド**:
- `create(item)`: カウンター情報を作成
- `get(userId, featureIdPeriod)`: カウンター情報を取得
- `increment(userId, featureIdPeriod)`: アトミックに加算
- `findByGrantId(grantId)`: 権限付与IDで検索
- `findByPeriodTypeAndResetTime(periodType, beforeTime)`: リセット対象を検索
- `reset(userId, featureIdPeriod, nextResetTime)`: カウンターをリセット
- `batchDelete(items)`: 一括削除（最大25件ずつ）

#### PermissionGrantRepository
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/repositories/permissionGrantRepository.ts`

**メソッド**:
- `create(item)`: 権限付与履歴を作成
- `get(grantId)`: 権限付与履歴を取得
- `findByUserIdAndStatus(userId, status)`: ユーザーID+状態で検索
- `updateStatus(grantId, status, revokedAt)`: 状態を更新

### 2.4 インフラ構成

#### AuthorizationSystem Construct
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts`

**作成リソース**:
- DynamoDBテーブル x2（UsageCounter、PermissionGrant）
- Lambda関数 x5（grant、revoke、check、increment、reset）
- EventBridge Rules x2（日次・月次リセット）

**IAM権限**:
- DynamoDB読み書き権限
- STS AssumeRole権限（テナントロール引き受け用）
- API Gateway Invoke権限（OpenFGA呼び出し用）
- DynamoDB Scan/GetItem権限（TenantManagerテーブル読み取り）

#### TenantAuthorizationStack
**場所**: `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts`

**役割**: テナント専用のAuthorizationSystemスタックを作成

### 2.5 OpenFGA連携

#### OpenFGAスキーマ（Authorization Model）
```
type user

type feature
  relations
    define can_access: [user]
```

**Tuple例**:
```
user:john@example.com, can_access, feature:gpt-4
```

**チェック方法**:
```json
POST /stores/{storeId}/check
{
  "tuple_key": {
    "user": "user:john@example.com",
    "relation": "can_access",
    "object": "feature:gpt-4"
  }
}
```

**認証方式**:
- API Gateway（IAM認証）経由
- SigV4署名付きリクエスト
- テナントロールをAssumeRoleして取得したクレデンシャルを使用

## 3. 統括責務実装のための必須修正事項まとめ

### 3.1 Lambda-to-Lambda呼び出し対応が未実装

**現状**: すべてのLambda関数がAPI Gateway + IAM認証経由でのみ呼び出し可能

**課題**: 統括責務（Orchestrator）が他のLambda関数を呼び出す際、以下のいずれかが必要
1. Lambda SDK経由で直接呼び出し（推奨）
2. API Gateway経由で呼び出し（現状のまま）

**推奨対応**:

#### 対応案A: Lambda InvokeCommandを使用（推奨）

Lambda関数に環境変数で他のLambda関数のARNを渡し、Lambda SDKで直接呼び出す。

**メリット**:
- レイテンシーが低い
- API Gatewayのコスト不要
- シンプルな実装

**必要な修正**:
1. `authorization-system.ts`で各Lambda関数のARNを出力
2. Orchestrator Lambda関数に環境変数でARNを渡す
3. Orchestrator側でLambda InvokeCommandを使用

**実装例**:
```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

const grantPermissionFunctionArn = process.env.GRANT_PERMISSION_FUNCTION_ARN;

const response = await lambdaClient.send(new InvokeCommand({
  FunctionName: grantPermissionFunctionArn,
  InvocationType: 'RequestResponse',
  Payload: JSON.stringify({
    tenantId: 'tenant001',
    userId: 'user123',
    grantId: 'grant-uuid',
    features: [...],
    sourceType: 'subscription',
    sourceId: 'sub-123'
  })
}));

const result = JSON.parse(new TextDecoder().decode(response.Payload));
```

**IAM権限の追加**:
```typescript
orchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['lambda:InvokeFunction'],
  resources: [
    authorizationSystem.grantPermissionFunction.functionArn,
    authorizationSystem.revokePermissionFunction.functionArn,
    authorizationSystem.checkPermissionFunction.functionArn,
    authorizationSystem.incrementUsageCountFunction.functionArn
  ]
}));
```

#### 対応案B: API Gateway経由で呼び出し（現状維持）

現状の実装を活かして、API Gateway経由で呼び出す。

**メリット**:
- 既存の認証・認可フローをそのまま使える
- 修正範囲が小さい

**デメリット**:
- レイテンシーが高い
- API Gatewayのコスト増加

**必要な修正**:
1. Authorization Service用のAPI Gatewayエンドポイントを作成
2. Orchestrator Lambda関数にAPI Gateway呼び出し権限を付与

### 3.2 grantId生成ロジックの明確化

**現状**: `grantId`は呼び出し元が生成する仕様

**課題**: 統括責務がgrantIdを生成する際の規則が不明確

**推奨対応**:

```typescript
import { randomUUID } from 'crypto';

// grantId生成関数
function generateGrantId(sourceType: string, sourceId: string): string {
  // フォーマット: {sourceType}_{sourceId}_{uuid}
  return `${sourceType}_${sourceId}_${randomUUID()}`;
}

// 使用例
const grantId = generateGrantId('subscription', subscription.subscription_id);
// 結果: "subscription_sub-123_a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 3.3 エラーハンドリングとリトライ

**現状**: 各Lambda関数は基本的なエラーハンドリングのみ

**課題**: 統括責務から呼び出す際、一時的なエラー（タイムアウト、RateLimit）のリトライが必要

**推奨対応**:

```typescript
async function invokeWithRetry<T>(
  lambdaClient: LambdaClient,
  functionArn: string,
  payload: any,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await lambdaClient.send(new InvokeCommand({
        FunctionName: functionArn,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(payload)
      }));

      if (response.FunctionError) {
        const errorPayload = JSON.parse(new TextDecoder().decode(response.Payload));
        throw new Error(`Lambda error: ${errorPayload.errorMessage}`);
      }

      return JSON.parse(new TextDecoder().decode(response.Payload));
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        throw error;
      }

      // 指数バックオフ
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw new Error('Unreachable');
}
```

### 3.4 権限剥奪時の一括削除対応

**現状**: `revokePermission`はgrantId単位で削除

**課題**: ユーザーが持つすべての権限を一括削除する機能がない

**推奨対応**:

**方法1**: 複数のgrantIdを受け取れるように拡張
```typescript
interface RevokePermissionRequest {
  tenantId: string;
  grantIds: string[]; // 配列に変更
}
```

**方法2**: ユーザーIDで検索して全削除する新しいLambda関数を追加
```typescript
// revokeAllPermissionsByUserId.ts
export const handler = async (event: { tenantId: string; userId: string }) => {
  // 1. PermissionGrantRepositoryでユーザーの全grantIdを取得
  const grants = await permissionGrantRepository.findByUserIdAndStatus(userId, 'active');

  // 2. 各grantIdに対してrevokePermissionを呼び出し
  for (const grant of grants) {
    await revokePermission({ tenantId, grantId: grant.grantId });
  }
};
```

### 3.5 カウンターの初期化タイミング

**現状**: `grantPermission`でカウンターを作成

**課題**: 権限付与直後に利用した場合、カウンターが存在しない可能性

**推奨対応**:

`checkPermission`と`incrementUsageCount`でカウンターが存在しない場合の処理を追加:

```typescript
// checkPermission.ts 内
const dailyCounter = await usageCountRepository.get(userId, `${featureId}#daily`);

if (!dailyCounter) {
  // カウンターが存在しない = unlimited または付与直後
  console.log(`Counter not found for ${userId}, ${featureId}#daily - treating as unlimited`);
  usage.daily = undefined;
} else {
  // 既存の処理
  ...
}
```

### 3.6 統括責務からの呼び出しフロー例

#### サブスクリプション承認時の権限付与

```typescript
// approveSubscription.ts 内
// TODO部分の実装

// 3. OpenFGAに権限を登録 & 4. 利用回数カウンターを初期化
const grantId = generateGrantId('subscription', subscription.subscription_id);

// プラン情報からfeaturesを構築
const plan = await planRepository.findById(subscription.plan_id);
const features = plan.features.map(f => ({
  featureId: f.feature_id,
  limitType: f.limit_type,
  limitCount: f.limit_count
}));

// Authorization Serviceを呼び出し
await invokeWithRetry(lambdaClient, process.env.GRANT_PERMISSION_FUNCTION_ARN!, {
  tenantId: adminResult.tenantId,
  userId: subscription.user_id,
  grantId,
  features,
  sourceType: 'subscription',
  sourceId: subscription.subscription_id
});

console.log(`Granted permissions for subscription ${subscription.subscription_id}, grantId: ${grantId}`);
```

#### サブスクリプション解約時の権限剥奪

```typescript
// cancelSubscription.ts 内

// 既存のサブスクリプション取得処理後

// 権限を剥奪
const userPlanApplications = await userPlanApplicationRepository.findBySubscriptionId(subscriptionId);

for (const application of userPlanApplications) {
  // application_source_idにgrantIdが入っていると仮定
  // または、PermissionGrantRepositoryでsubscriptionIdから検索
  const grants = await permissionGrantRepository.findBySourceId(subscriptionId);

  for (const grant of grants) {
    await invokeWithRetry(lambdaClient, process.env.REVOKE_PERMISSION_FUNCTION_ARN!, {
      tenantId: subscription.tenant_id,
      grantId: grant.grantId
    });
  }
}

console.log(`Revoked permissions for subscription ${subscriptionId}`);
```

## 4. まとめ

### 4.1 実装済みの機能

✅ **完全に実装済み**:
- OpenFGA連携（権限チェック、権限登録・削除）
- カウント機構（作成、加算、リセット、削除）
- 権限付与・剥奪Lambda関数
- 権限付与履歴管理
- 日次・月次カウンターリセット

### 4.2 統括責務実装前の必須対応

- [ ] **Lambda-to-Lambda呼び出し対応**（対応案A推奨）
  - Authorization Service Lambda関数のARNをOrchestratorに環境変数で渡す
  - Orchestrator LambdaにLambda Invoke権限を付与
  - Lambda InvokeCommandでの呼び出し実装

- [ ] **grantId生成ルールの実装**
  - 統括責務側で`generateGrantId`関数を実装
  - フォーマット: `{sourceType}_{sourceId}_{uuid}`

- [ ] **エラーハンドリングとリトライの実装**
  - 統括責務側で`invokeWithRetry`関数を実装
  - 指数バックオフによるリトライ

- [ ] **権限剥奪の一括削除対応（オプション）**
  - ユーザーIDで全権限を削除する関数の追加
  - または、既存のrevokePermissionを配列対応に拡張

- [ ] **approveSubscription、rejectSubscription、cancelFlowでの呼び出し実装**
  - TODOコメント箇所の実装
  - OpenFGA権限登録・剥奪
  - カウンター初期化

### 4.3 オプション対応

- [ ] カウンター不在時の処理改善（checkPermission、incrementUsageCount）
- [ ] PermissionGrantRepositoryに`findBySourceId`メソッドを追加
- [ ] 権限変更ログの強化（CloudWatch Logs Insightsでの分析用）
- [ ] モニタリングダッシュボードの作成（権限付与・剥奪の統計）

## 5. 参考情報

### 5.1 関連ドキュメント
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/docs/AUTHORIZATION_SYSTEM.md`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/docs/AUTHORIZATION_GRANTS.md`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/docs/OPENFGA_IMPLEMENTATION.md`

### 5.2 実装ファイル一覧

**Lambda関数**:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/grantPermission.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/revokePermission.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/checkPermission.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/incrementUsageCount.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/resetUsageCount.ts`

**リポジトリ**:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/repositories/usageCountRepository.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/repositories/permissionGrantRepository.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/authorization/repositories/types.ts`

**CDK構成**:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts`

### 5.3 呼び出し側の実装箇所

**TODO実装が必要な箇所**:
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/admin/subscription-management/approveSubscription.ts` (L148-152)
  ```typescript
  // TODO: 以下の処理を実装
  // 3. OpenFGAに権限を登録
  // 4. 利用回数カウンターを初期化
  ```
