# バックエンドAPI実装方針：プラン購入フロー

このドキュメントでは、ユーザがプランを購入する際に必要となるバックエンドAPIの実装方針を説明します。

## 前提となる既存実装

現在のシステムでは、以下の基盤が既に実装されています。

### 既に実装されているもの

1. **データモデル層**
   - Plansテーブル（プラン定義）
   - Subscriptionsテーブル（サブスクリプション情報）
   - UserPlanApplicationsテーブル（ユーザへのプラン適用）
   - 各テーブルに対応するRepository層

2. **Stripe統合基盤**
   - Webhook受信機能
   - 署名検証機能
   - イベント重複検知機能
   - EventBridge連携

3. **Orchestration基盤**
   - 購入フロー統括処理（`purchaseFlow.ts`）
   - ロールバック機構
   - ステップ実行管理

4. **Payment Gateway**
   - Checkout Session作成関数（`createCheckoutSession.ts`）
   - レシート検証関数（`verifyReceipt.ts`）
   - Webhook受信関数

5. **内部連携API**
   - Plan Managementの内部関数群（プラン適用、終了など）
   - Subscription Managementの内部関数群（サブスク作成、更新など）

### 現在のAPI Gatewayエンドポイント構成

現在は以下のエンドポイントが存在します。

```
POST /billing/webhook/{tenantId}/stripe    （Stripe Webhook受信）
POST /billing/webhook/{tenantId}/apple     （Apple通知受信）
POST /billing/webhook/{tenantId}/google    （Google通知受信）
POST /billing/operations/checkout          （Checkout Session作成）※削除予定
POST /billing/operations/update            （サブスク変更）
POST /billing/operations/cancel            （サブスクキャンセル）
GET  /billing/operations/invoice           （請求書取得）
```

## 購入フローで必要となるユーザ向けAPI

フロントエンド実装方針で定義された5つのAPIについて、どのように実装するかを説明します。

---

## API 1: プラン一覧取得API **実装済**

### 目的

ユーザが選択できるプラン（「Freeプラン」「Standardプラン」など）の一覧を、プラットフォーム別に取得します。

### エンドポイント

```
GET /api/plans?platform={platform}
```

### 認証

必要（Cognitoトークンによる認証）

### リクエスト

**クエリパラメータ（必須）**:

- `platform`: クライアントプラットフォームの指定
  - `web`: Web版（Stripe決済）
  - `ios`: iOS版（App Store内課金）
  - `android`: Android版（Google Play内課金）

### レスポンス例

**成功時（200 OK）**:

```json
{
  "platform": "web",
  "plans": [
    {
      "planId": "plan_001",
      "planName": "Freeプラン",
      "displayName": "無料プラン",
      "description": "基本的な機能をお試しいただけます",
      "pricing": {
        "amount": 0,
        "currency": "JPY",
        "interval": "month"
      },
      "features": [
        "モデルAへのアクセス（1日10回まで）",
        "基本的なチャット機能"
      ],
      "platformProductId": null,
      "status": "active"
    },
    {
      "planId": "plan_002",
      "planName": "Standardプラン",
      "displayName": "スタンダードプラン",
      "description": "より多くの機能とモデルをご利用いただけます",
      "pricing": {
        "amount": 1000,
        "currency": "JPY",
        "interval": "month"
      },
      "features": ["モデルA・Bへの無制限アクセス", "優先サポート"],
      "platformProductId": "price_1234567890abcdef",
      "status": "active"
    }
  ]
}
```

**パラメータエラー時（400 Bad Request）**:

```json
{
  "error": {
    "code": "MISSING_PARAMETER",
    "message": "必須パラメータが指定されていません",
    "details": {
      "field": "platform",
      "reason": "platformパラメータは必須です。'web', 'ios', 'android' のいずれかを指定してください"
    }
  }
}
```

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "無効なパラメータが指定されました",
    "details": {
      "field": "platform",
      "value": "windows",
      "reason": "platformには 'web', 'ios', 'android' のいずれかを指定してください"
    }
  }
}
```

### 実装方法

#### Lambda関数の配置

```
packages/cdk/lambda/billing/user-api/plans/listPlans.ts
```

#### 処理の流れ

1. **認証確認**: Cognitoトークンからユーザ情報とテナントIDを取得します
2. **パラメータ検証**:
   - `platform`パラメータの存在確認（必須）
   - 値が `web`, `ios`, `android` のいずれかであることを検証
   - 不正な場合は400エラーを返します
3. **プラットフォームマッピング**:
   - `web` → `stripe`
   - `ios` → `apple`
   - `android` → `google`
4. **プラン一覧取得**: PlanRepositoryの`findActiveByPlatform`メソッドを使って、指定プラットフォームかつステータスが「active」のプラン一覧を取得します
5. **フィルタリング**: 内部管理用プランを除外し、ユーザに公開可能なプランのみを抽出します
6. **フォーマット**: フロントエンドが必要とする形式にデータを整形します
7. **レスポンス**: プラットフォーム情報を含むJSON形式でプラン一覧を返します

#### 依存関係

- **PlanRepository**: RDSのPlansテーブルからプラン情報を取得
- **認証基盤**: Cognitoトークンの検証

#### エラーハンドリング

- platformパラメータなし: 400エラー（MISSING_PARAMETER）を返します
- platformパラメータ不正: 400エラー（INVALID_PARAMETER）を返します
- 認証失敗: 401エラーを返します
- データベース接続エラー: 500エラーを返し、CloudWatchにログを記録します
- プランが1件も存在しない: 空の配列を返します（エラーではない）

#### CDK定義での追加内容

`packages/cdk/lib/construct/api/user-billing-api.ts`（新規作成）に定義します。

```typescript
// ユーザ向けAPI専用のConstruct
const listPlansFunction = new NodejsFunction(this, 'ListPlans', {
  runtime: LAMBDA_RUNTIME_NODEJS,
  entry: './lambda/billing/user-api/plans/listPlans.ts',
  timeout: Duration.seconds(10),
  memorySize: 256,
  environment: {
    // RDS接続情報は実行時に動的に取得
  },
});

// RDS読み取り権限
listPlansFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['rds:DescribeDBInstances'],
    resources: ['*'],
  })
);

// API Gatewayエンドポイント
const apiResource = api.root.addResource('api');
const plansResource = apiResource.addResource('plans');
plansResource.addMethod('GET', new LambdaIntegration(listPlansFunction), {
  authorizer: authorizer,
  authorizationType: AuthorizationType.COGNITO,
});
```

#### 実装コード例

```typescript
// packages/cdk/lambda/billing/user-api/plans/listPlans.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';

interface PlatformMapping {
  [key: string]: string;
}

const PLATFORM_MAPPING: PlatformMapping = {
  web: 'stripe',
  ios: 'apple',
  android: 'google',
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // 1. 認証確認（詳細は省略）
    const { userId, tenantId } = await getUserFromToken(event);

    // 2. platformパラメータの取得と検証
    const platformParam = event.queryStringParameters?.platform;

    // パラメータが指定されていない場合
    if (!platformParam) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'platform',
              reason:
                "platformパラメータは必須です。'web', 'ios', 'android' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // パラメータが不正な場合
    if (!['web', 'ios', 'android'].includes(platformParam)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'platform',
              value: platformParam,
              reason:
                "platformには 'web', 'ios', 'android' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // 3. プラットフォームマッピング
    const platformType = PLATFORM_MAPPING[platformParam];

    // 4. プラットフォーム別のプラン取得
    const plans = await invokeDataAccessFunction<Plan[]>(
      event,
      'plan',
      'findActiveByPlatform',
      platformType
    );

    // 5. レスポンスの構築
    const response = {
      platform: platformParam,
      plans: plans.map((plan) => ({
        planId: plan.plan_id,
        planName: plan.internal_name,
        displayName: plan.display_name,
        description: plan.description,
        pricing: extractPricing(plan),
        features: extractFeatures(plan.permissions),
        platformProductId: plan.platform_product_id,
        status: plan.status,
      })),
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error fetching plans:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
        },
      }),
    };
  }
};
```

---

## API 2: Checkout Session作成API **実装済**

### 目的

Stripe Checkout Sessionを作成し、フロントエンドが支払いフォームを表示するための情報を返します。

### エンドポイント

```
POST /api/subscriptions/checkout-session
```

### 認証

必要（Cognitoトークンによる認証）

### リクエストボディ

```json
{
  "planId": "plan_002"
}
```

### レスポンス例

```json
{
  "clientSecret": "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
  "sessionId": "cs_test_1234567890"
}
```

### 実装方法

#### Lambda関数の配置

既存の`createCheckoutSession.ts`を使用しますが、エンドポイントを変更します。

```
packages/cdk/lambda/billing/payment-gateway/operations/createCheckoutSession.ts
```

#### 現在の実装状況

既に実装済みです。以下の処理を行っています。

1. CognitoトークンからテナントIDとユーザIDを取得
2. リクエストボディから`planId`を取得
3. PlanRepositoryで`planId`に対応するStripe Price IDを取得
4. Secrets Managerからテナント専用のStripe APIキーを取得
5. StripeのCheckout Session作成APIを呼び出し
6. `clientSecret`と`sessionId`を返す

#### 必要な変更点

**現在**: エンドポイントが`POST /billing/operations/checkout`

**変更後**: エンドポイントを`POST /api/subscriptions/checkout-session`に変更

この変更は、CDK定義（`payment-gateway.ts`）で行います。

#### 変更の理由

- `billing/operations/checkout`は元々、統括責務Lambda関数から内部的に呼び出すためのエンドポイントとして設計されていました
- しかし実際には、統括責務からはLambda to Lambda（直接呼び出し）で連携しているため、API Gatewayエンドポイントは不要です
- 代わりに、ユーザ向けのエンドポイントとして`/api/subscriptions/checkout-session`を公開します
- これにより、フロントエンドから直接呼び出せるようになります

#### CDK定義での変更内容

`packages/cdk/lib/construct/api/payment-gateway.ts`を以下のように変更します。

**削除する部分**:

```typescript
// 削除: billing/operations/checkoutエンドポイント
const operationsResource = billingResource.addResource('operations');
const checkoutResource = operationsResource.addResource('checkout');
checkoutResource.addMethod('POST', ...);
```

`packages/cdk/lib/construct/api/user-billing-api.ts`に以下を追加します。

**追加する部分**:

```typescript
// 追加: /api/subscriptions/checkout-sessionエンドポイント
const apiResource = api.root.addResource('api');
const subscriptionsResource = apiResource.addResource('subscriptions');
const checkoutSessionResource =
  subscriptionsResource.addResource('checkout-session');
checkoutSessionResource.addMethod(
  'POST',
  new LambdaIntegration(paymentGatewayApi.createCheckoutSessionFunction),
  {
    authorizer: authorizer,
    authorizationType: AuthorizationType.COGNITO,
  }
);
```

#### エラーハンドリング

既に実装されています。

- 認証失敗: 401エラー
- プランが存在しない: 404エラー
- Stripe APIエラー: 500エラー
- Secrets Managerエラー: 500エラー

---

## API 3: セッション状態確認API

### 目的

支払い完了後、指定されたCheckout Sessionの状態を確認します。支払いが成功したかどうかを判定するために使用します。

### エンドポイント

```
GET /api/subscriptions/checkout-session/{session_id}/status
```

### 認証

必要（Cognitoトークンによる認証）

### パスパラメータ

- `session_id`: Checkout SessionのID（例: `cs_test_1234567890`）

### レスポンス例

**支払い成功の場合**:

```json
{
  "status": "complete",
  "paymentStatus": "paid",
  "planName": "Standardプラン",
  "amount": 1000,
  "currency": "JPY",
  "customerEmail": "user@example.com",
  "nextBillingDate": "2025-12-20T00:00:00Z"
}
```

**支払い失敗の場合**:

```json
{
  "status": "incomplete",
  "paymentStatus": "unpaid",
  "errorMessage": "カード残高が不足しています"
}
```

**セッションが期限切れの場合**:

```json
{
  "status": "expired",
  "errorMessage": "このセッションは有効期限が切れています"
}
```

### 実装方法

#### Lambda関数の配置

```
packages/cdk/lambda/billing/user-api/subscriptions/getCheckoutSessionStatus.ts
```

#### 処理の流れ

1. **認証確認**: Cognitoトークンからユーザ情報とテナントIDを取得します
2. **パスパラメータ取得**: URLから`session_id`を取得します
3. **Stripe APIキー取得**: Secrets Managerからテナント専用のStripe APIキーを取得します
4. **セッション情報取得**: Stripe APIを呼び出して、セッション情報を取得します
5. **権限検証**: セッションのメタデータに含まれる`userId`と、リクエスト送信者のユーザIDが一致するか確認します
   - 一致しない場合: 403エラーを返します（他のユーザのセッションにアクセスしようとしている）
6. **状態判定**: セッションの`status`と`payment_status`を確認します
7. **レスポンス**: セッション状態をJSON形式で返します

#### セッション状態の種類

Stripeのセッションには以下の状態があります。

| status     | payment_status | 意味                                                             |
| ---------- | -------------- | ---------------------------------------------------------------- |
| `complete` | `paid`         | 支払い成功・完了                                                 |
| `complete` | `unpaid`       | セッションは完了したが支払いは未完了（猶予期間中）               |
| `open`     | -              | セッションはまだ開いている（ユーザが支払いフォームにアクセス中） |
| `expired`  | -              | セッションが有効期限切れ（24時間経過）                           |

フロントエンドでは、`status === "complete" && payment_status === "paid"`の場合のみ、次のアクティベーションAPIを呼び出します。

#### 依存関係

- **Stripe SDK**: セッション情報を取得
- **Secrets Manager**: テナント専用のStripe APIキーを取得
- **認証基盤**: Cognitoトークンの検証

#### エラーハンドリング

- 認証失敗: 401エラー
- 権限エラー（他のユーザのセッション）: 403エラー
- セッションが見つからない: 404エラー
- Stripe APIエラー: 500エラー

#### CDK定義での追加内容

`packages/cdk/lib/construct/api/user-billing-api.ts`に追加します。

```typescript
const getCheckoutSessionStatusFunction = new NodejsFunction(
  this,
  'GetCheckoutSessionStatus',
  {
    runtime: LAMBDA_RUNTIME_NODEJS,
    entry:
      './lambda/billing/user-api/subscriptions/getCheckoutSessionStatus.ts',
    timeout: Duration.seconds(10),
    memorySize: 256,
    environment: {
      // Secrets Manager ARNは実行時に動的に決定
    },
  }
);

// Secrets Manager読み取り権限
getCheckoutSessionStatusFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['secretsmanager:GetSecretValue'],
    resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
  })
);

// API Gatewayエンドポイント
const sessionIdResource = checkoutSessionResource.addResource('{sessionId}');
const statusResource = sessionIdResource.addResource('status');
statusResource.addMethod(
  'GET',
  new LambdaIntegration(getCheckoutSessionStatusFunction),
  {
    authorizer: authorizer,
    authorizationType: AuthorizationType.COGNITO,
  }
);
```

---

## API 4: プランアクティベーションAPI

### 目的

支払い成功したCheckout Sessionに基づいて、即座にプランを有効化します。これにより、ユーザは支払い完了後すぐにプランの機能を利用開始できます。

### 重要性

このAPIは購入フローの中で**最も重要**なAPIです。ユーザ体験に直結し、以下の役割を果たします。

- **即座の利用開始**: Webhookを待たずに、支払い完了後すぐにプランを有効化
- **確実性の保証**: purchaseFlow内での冪等性担保により、return_url経由とWebhook経由の両方が実行されても、最終的には必ず一度だけ有効化される
- **セキュリティ**: セッション検証により、不正なアクティベーションを防止

### 冪等性の担保について

**重要**: このAPI自体では冪等性チェックを行いません。冪等性は`purchaseFlow.ts`（Orchestration層）で担保されます。

- このAPIは認証とパラメータ検証を行い、purchaseFlowを呼び出すシンプルなラッパーです
- 同じセッションIDで複数回呼ばれた場合、purchaseFlow側で重複処理を検知し、既存の結果を返します
- これにより、API層とOrchestration層の責務が明確に分離されます

### エンドポイント

```
POST /api/subscriptions/activate-from-session
```

### 認証

必要（Cognitoトークンによる認証）

### リクエストボディ

```json
{
  "sessionId": "cs_test_1234567890"
}
```

### 成功レスポンス例

```json
{
  "success": true,
  "subscriptionId": "sub_abc123",
  "planId": "plan_002",
  "planName": "Standardプラン",
  "activatedAt": "2025-11-20T12:34:56Z",
  "nextBillingDate": "2025-12-20T00:00:00Z"
}
```

**注**: レスポンスの詳細な内容はpurchaseFlowの戻り値によって決まります。purchaseFlowが冪等性チェックにより「既に処理済み」と判定した場合でも、成功レスポンスが返されます。

### エラーレスポンス例

```json
{
  "success": false,
  "errorCode": "SESSION_NOT_FOUND",
  "errorMessage": "指定されたセッションが見つかりません"
}
```

```json
{
  "success": false,
  "errorCode": "PAYMENT_INCOMPLETE",
  "errorMessage": "支払いがまだ完了していません"
}
```

```json
{
  "success": false,
  "errorCode": "PERMISSION_DENIED",
  "errorMessage": "このセッションにアクセスする権限がありません"
}
```

### 実装方法

#### Lambda関数の配置

```
packages/cdk/lambda/billing/user-api/subscriptions/activateFromSession.ts
```

#### 処理の流れ

このAPIはシンプルな4つのステップで構成されています。

##### ステップ1: 認証とパラメータ検証

1. Cognitoトークンからユーザ情報（ユーザID、テナントID）を取得します
2. リクエストボディから`sessionId`を取得します
3. `sessionId`が空でないか検証します

##### ステップ2: セッション情報の取得と検証

1. Secrets Managerからテナント専用のStripe APIキーを取得します
2. Stripe APIを呼び出して、セッション情報を取得します
   - セッションが存在しない場合: `SESSION_NOT_FOUND`エラーを返します
3. セッションの状態を確認します
   - `status`が`complete`でない場合: `PAYMENT_INCOMPLETE`エラーを返します
   - `payment_status`が`paid`でない場合: `PAYMENT_INCOMPLETE`エラーを返します
4. セッションのメタデータから`userId`を取得します
5. リクエスト送信者のユーザIDと一致するか確認します
   - 一致しない場合: `PERMISSION_DENIED`エラーを返します

##### ステップ3: プラン情報の取得

1. セッションから`line_items`を取得します
2. `line_items`に含まれる`price_id`（Stripeの価格ID）を取得します
3. PlanRepositoryで`platform_product_id`（Stripeの価格ID）に対応するプランを検索します
   - プランが見つからない場合: `PLAN_NOT_FOUND`エラーを返します

##### ステップ4: purchaseFlowの呼び出しとレスポンス返却

既に実装されている`purchaseFlow`（統括責務）を呼び出します。purchaseFlowは以下の処理を自動的に実行します。

1. レシート検証（セッション情報の再検証）
2. **冪等性チェック**（同じセッションIDで既に処理済みかを確認）
3. サブスクリプション情報のDB記録
4. プラン適用
5. 権限付与（将来実装）

Orchestrationフローの呼び出しは、Lambda to Lambda（直接呼び出し）で行います。

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});

const purchaseFlowInput = {
  tenantId,
  userId,
  planId,
  paymentPlatform: 'stripe',
  receiptData: {
    sessionId: sessionId,
    // その他のセッション情報
  },
};

const invokeCommand = new InvokeCommand({
  FunctionName: process.env.PURCHASE_FLOW_FUNCTION_ARN,
  InvocationType: 'RequestResponse', // 同期呼び出し
  Payload: JSON.stringify(purchaseFlowInput),
});

const response = await lambdaClient.send(invokeCommand);
const result = JSON.parse(new TextDecoder().decode(response.Payload));

if (!result.success) {
  // Orchestrationフロー失敗
  throw new Error(`Purchase flow failed: ${result.errorDetails?.errorMessage}`);
}

// purchaseFlowの結果をそのまま返す
return {
  statusCode: 200,
  body: JSON.stringify(result),
};
```

**重要**: 冪等性チェックはpurchaseFlow内で行われます。同じセッションIDで複数回このAPIが呼ばれた場合でも、purchaseFlowが重複処理を検知し、既存の結果を返すため、安全に動作します

#### 依存関係

- **Stripe SDK**: セッション情報の取得と検証
- **Secrets Manager**: テナント専用のStripe APIキーを取得
- **PlanRepository**: Stripe Price IDからプランIDへの変換
- **Orchestration Flow**: 購入フローの統括処理（purchaseFlow Lambda関数）
- **Lambda Client**: 統括フローを呼び出すためのAWS SDK

#### エラーハンドリング

各ステップで発生しうるエラーとその対処方法を定義します。

| エラーコード           | 原因                   | HTTPステータス | 対処方法                                                     |
| ---------------------- | ---------------------- | -------------- | ------------------------------------------------------------ |
| `SESSION_NOT_FOUND`    | セッションIDが無効     | 404            | ユーザに「セッションが見つかりません」と表示                 |
| `PAYMENT_INCOMPLETE`   | 支払いが完了していない | 400            | ユーザに「支払いが完了していません」と表示                   |
| `PERMISSION_DENIED`    | 他のユーザのセッション | 403            | ユーザに「アクセス権限がありません」と表示                   |
| `PLAN_NOT_FOUND`       | プランが存在しない     | 404            | 管理者にアラート・ユーザには「エラーが発生しました」と表示   |
| `PURCHASE_FLOW_FAILED` | 統括フロー失敗         | 500            | CloudWatchにログ記録・ユーザには「処理に失敗しました」と表示 |

#### CDK定義での追加内容

`packages/cdk/lib/construct/api/user-billing-api.ts`に追加します。

```typescript
const activateFromSessionFunction = new NodejsFunction(
  this,
  'ActivateFromSession',
  {
    runtime: LAMBDA_RUNTIME_NODEJS,
    entry: './lambda/billing/user-api/subscriptions/activateFromSession.ts',
    timeout: Duration.seconds(60), // Orchestrationフロー呼び出しを含むため長めに設定
    memorySize: 512,
    environment: {
      PURCHASE_FLOW_FUNCTION_ARN:
        orchestrationFunctions.purchaseFlow.functionArn,
    },
  }
);

// Secrets Manager読み取り権限
activateFromSessionFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['secretsmanager:GetSecretValue'],
    resources: ['arn:aws:secretsmanager:*:*:secret:*/billing/stripe*'],
  })
);

// RDS読み取り権限（PlanRepository用）
activateFromSessionFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['rds:DescribeDBInstances'],
    resources: ['*'],
  })
);

// Lambda呼び出し権限（Orchestrationフロー用）
activateFromSessionFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['lambda:InvokeFunction'],
    resources: [orchestrationFunctions.purchaseFlow.functionArn],
  })
);

// API Gatewayエンドポイント
const activateResource = subscriptionsResource.addResource(
  'activate-from-session'
);
activateResource.addMethod(
  'POST',
  new LambdaIntegration(activateFromSessionFunction),
  {
    authorizer: authorizer,
    authorizationType: AuthorizationType.COGNITO,
  }
);
```

---

## API 5: 現在のプラン情報取得API

### 目的

ログイン中のユーザが現在どのプランに入っているか、サブスクリプションの状態はどうか、次回請求日はいつか、などの情報を取得します。

### エンドポイント

```
GET /api/subscriptions/current
```

### 認証

必要（Cognitoトークンによる認証）

### リクエスト

パラメータなし（認証トークンからユーザ情報を取得）

### レスポンス例

**有料プランに加入している場合**:

```json
{
  "planId": "plan_002",
  "planName": "Standardプラン",
  "displayName": "スタンダードプラン",
  "status": "active",
  "subscriptionId": "sub_abc123",
  "platformType": "stripe",
  "currentPeriodStart": "2025-11-20T00:00:00Z",
  "currentPeriodEnd": "2025-12-20T00:00:00Z",
  "nextBillingDate": "2025-12-20T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "amount": 1000,
  "currency": "JPY",
  "interval": "month"
}
```

**Freeプランの場合**:

```json
{
  "planId": "plan_001",
  "planName": "Freeプラン",
  "displayName": "無料プラン",
  "status": "active",
  "subscriptionId": null,
  "platformType": null,
  "currentPeriodStart": null,
  "currentPeriodEnd": null,
  "nextBillingDate": null,
  "cancelAtPeriodEnd": false,
  "amount": 0,
  "currency": "JPY",
  "interval": "month"
}
```

**解約予定の場合**:

```json
{
  "planId": "plan_002",
  "planName": "Standardプラン",
  "displayName": "スタンダードプラン",
  "status": "active",
  "subscriptionId": "sub_abc123",
  "platformType": "stripe",
  "currentPeriodStart": "2025-11-20T00:00:00Z",
  "currentPeriodEnd": "2025-12-20T00:00:00Z",
  "nextBillingDate": null,
  "cancelAtPeriodEnd": true,
  "serviceEndDate": "2025-12-20T00:00:00Z",
  "amount": 1000,
  "currency": "JPY",
  "interval": "month"
}
```

### 実装方法

#### Lambda関数の配置

```
packages/cdk/lambda/billing/user-api/subscriptions/getCurrentSubscription.ts
```

#### 処理の流れ

1. **認証確認**: Cognitoトークンからユーザ情報（ユーザID、テナントID）を取得します
2. **プラン適用情報の取得**: UserPlanApplicationRepositoryで、このユーザの有効なプラン適用を取得します
   - ステータスが`active`または`scheduled_termination`のものを検索
   - 有効期限が未来のものを検索
3. **プラン情報の取得**: PlanRepositoryで、適用されているプランの詳細情報を取得します
4. **サブスクリプション情報の取得**: プラン適用のソースが「subscription」の場合、SubscriptionRepositoryでサブスクリプション情報を取得します
   - プラットフォーム種別（Stripe/Apple/Google）
   - サブスクリプションID
   - 現在の期間（`current_period_start`, `current_period_end`）
   - 次回請求日
   - 解約予定フラグ（`cancel_at_period_end`）
5. **レスポンスの構築**: 取得した情報を組み合わせて、フロントエンドが必要とする形式にフォーマットします
6. **レスポンス返却**: JSON形式で返します

#### 特殊なケース

**ケース1: 複数のプラン適用が有効な場合**

- 優先順位を付けて、最も優先度の高いプラン適用を返します
- 優先順位: サブスクリプション > キャンペーン > トライアル > デフォルト

**ケース2: プラン適用が存在しない場合**

- デフォルトプラン（通常はFreeプラン）を返します

**ケース3: サブスクリプションが複数ある場合**

- 最新のサブスクリプションを返します

#### 依存関係

- **UserPlanApplicationRepository**: ユーザのプラン適用情報を取得
- **PlanRepository**: プラン詳細情報を取得
- **SubscriptionRepository**: サブスクリプション情報を取得
- **認証基盤**: Cognitoトークンの検証

#### エラーハンドリング

- 認証失敗: 401エラー
- ユーザが存在しない: 404エラー
- データベース接続エラー: 500エラー

#### CDK定義での追加内容

`packages/cdk/lib/construct/api/user-billing-api.ts`に追加します。

```typescript
const getCurrentSubscriptionFunction = new NodejsFunction(
  this,
  'GetCurrentSubscription',
  {
    runtime: LAMBDA_RUNTIME_NODEJS,
    entry: './lambda/billing/user-api/subscriptions/getCurrentSubscription.ts',
    timeout: Duration.seconds(10),
    memorySize: 256,
    environment: {
      // RDS接続情報は実行時に動的に取得
    },
  }
);

// RDS読み取り権限
getCurrentSubscriptionFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['rds:DescribeDBInstances'],
    resources: ['*'],
  })
);

// API Gatewayエンドポイント
const currentResource = subscriptionsResource.addResource('current');
currentResource.addMethod(
  'GET',
  new LambdaIntegration(getCurrentSubscriptionFunction),
  {
    authorizer: authorizer,
    authorizationType: AuthorizationType.COGNITO,
  }
);
```

---

## API構成の全体像

### 新規作成するエンドポイント

以下のエンドポイントを新規に追加します。

```
GET  /api/plans                                             （プラン一覧取得）
POST /api/subscriptions/checkout-session                   （Checkout Session作成）
GET  /api/subscriptions/checkout-session/{sessionId}/status（セッション状態確認）
POST /api/subscriptions/activate-from-session              （プランアクティベーション）
GET  /api/subscriptions/current                            （現在のプラン情報取得）
```

### 削除するエンドポイント

以下のエンドポイントを削除します。

```
POST /billing/operations/checkout  （不要・Lambda to Lambdaで代替）
```

### 変更しないエンドポイント

以下のエンドポイントはそのまま残します。

```
POST /billing/webhook/{tenantId}/stripe    （Stripe Webhook受信）
POST /billing/webhook/{tenantId}/apple     （Apple通知受信）
POST /billing/webhook/{tenantId}/google    （Google通知受信）
POST /billing/operations/update            （サブスク変更）
POST /billing/operations/cancel            （サブスクキャンセル）
GET  /billing/operations/invoice           （請求書取得）
```

---

## CDK構成の変更点まとめ

### 新規作成するファイル

1. `packages/cdk/lib/construct/api/user-billing-api.ts`
   - ユーザ向けAPI専用のConstruct
   - 5つの新しいエンドポイントを定義

2. Lambda関数（4つ）
   - `packages/cdk/lambda/billing/user-api/plans/listPlans.ts`
   - `packages/cdk/lambda/billing/user-api/subscriptions/getCheckoutSessionStatus.ts`
   - `packages/cdk/lambda/billing/user-api/subscriptions/activateFromSession.ts`
   - `packages/cdk/lambda/billing/user-api/subscriptions/getCurrentSubscription.ts`

### 変更するファイル

1. `packages/cdk/lib/construct/api/payment-gateway.ts`
   - `POST /billing/operations/checkout`エンドポイントの削除

2. `packages/cdk/lib/stacks/nested/billing-management-stack.ts`
   - UserBillingApiConstructの追加

---

## セキュリティ考慮事項

### 認証の徹底

すべてのユーザ向けAPIは、Cognitoトークンによる認証を必須とします。

- トークンの有効期限を確認
- トークンの署名を検証
- ユーザIDとテナントIDを確実に取得

### 権限の検証

セッション状態確認APIとアクティベーションAPIでは、以下の権限検証を行います。

- リクエスト送信者のユーザIDと、セッションに紐づくユーザIDが一致するか確認
- 一致しない場合は403エラーを返す
- これにより、他のユーザのセッション情報にアクセスできないようにする

### シークレットの管理

Stripe APIキーなどの機密情報は、必ずSecrets Managerで管理します。

- Lambda関数の環境変数に直接埋め込まない
- テナントごとに異なるシークレットを管理
- 実行時に動的に取得

### レート制限

API Gatewayでレート制限を設定し、不正利用を防止します。

- バーストレート: 100リクエスト/秒
- 定常レート: 50リクエスト/秒

### ログ記録と監査

すべてのAPI呼び出しを CloudWatch Logsに記録します。

- リクエストパラメータ（機密情報はマスク）
- レスポンス
- エラー詳細
- 実行時間

管理者向けの操作（手動でのプラン付与など）は、特に詳細なログを記録します。

---

## 監視とアラート

### CloudWatch Metrics

以下のカスタムメトリクスを記録します。

- API呼び出し成功率（API別）
- API呼び出し失敗率（API別）
- アクティベーションAPI成功率
- 平均レスポンス時間（API別）

### アラート設定

以下の条件でアラートを送信します。

- アクティベーションAPI成功率が90%を下回った場合
- API呼び出し失敗率が10%を超えた場合
- 平均レスポンス時間が5秒を超えた場合

### ダッシュボード

CloudWatch Dashboardで以下を可視化します。

- API呼び出し回数の推移
- 成功率の推移
- エラー種別の内訳
- レスポンス時間の分布

---

## テストとデバッグ

### ローカルテスト

SAM Localを使って、Lambda関数をローカルで実行してテストします。

```bash
sam local invoke ActivateFromSessionFunction --event test-event.json
```

### 統合テスト

実際のStripe Test環境を使って、エンドツーエンドのテストを行います。

1. Stripe Test Dashboardでテスト用の価格IDを作成
2. Checkout Session作成APIを呼び出す
3. Stripeのテストカード番号を使って支払いを完了
4. セッション状態確認APIで状態を確認
5. アクティベーションAPIでプランを有効化
6. 現在のプラン情報取得APIで結果を確認

### テストシナリオ

以下のシナリオをテストします。

**正常系**:

- 新規ユーザがプランを購入できる
- 支払い完了後、即座にプランが有効化される
- プラン情報を正しく取得できる

**異常系**:

- 無効なセッションIDでアクティベーションを試みる
- 他のユーザのセッションIDでアクティベーションを試みる
- 支払いが完了していないセッションでアクティベーションを試みる

**冪等性**:

- 同じセッションIDで複数回アクティベーションAPIを呼び出す
- return_url経由とWebhook経由の両方が実行される

**ロールバック**:

- プラン適用で失敗した場合、サブスクリプション記録がロールバックされる

---

## デプロイ手順

### 初回デプロイ

1. **Lambda関数とAPI Gatewayのデプロイ**

```bash
cd packages/cdk
npm run cdk deploy -- --only BillingManagementStack
```

2. **動作確認**

```bash
# プラン一覧取得APIのテスト（Web版）
curl -X GET "https://api.example.com/api/plans?platform=web" \
  -H "Authorization: Bearer YOUR_COGNITO_TOKEN"

# プラン一覧取得APIのテスト（iOS版）
curl -X GET "https://api.example.com/api/plans?platform=ios" \
  -H "Authorization: Bearer YOUR_COGNITO_TOKEN"

# パラメータなしでエラーになることを確認
curl -X GET https://api.example.com/api/plans \
  -H "Authorization: Bearer YOUR_COGNITO_TOKEN"
# Expected: 400 Bad Request
```

### 更新デプロイ

Lambda関数のコードを更新した場合:

```bash
npm run cdk deploy -- --only BillingManagementStack
```

---

## 実装の優先順位

以下の順番で実装することを推奨します。

### フェーズ1: 基盤の整備

1. UserBillingApiConstructの作成

### フェーズ2: 参照系APIの実装

1. プラン一覧取得API（`listPlans.ts`）
2. 現在のプラン情報取得API（`getCurrentSubscription.ts`）

これらは読み取り専用のため、比較的安全に実装できます。

### フェーズ3: Checkout関連APIの実装

1. Checkout Session作成APIのエンドポイント変更（CDK変更のみ）
2. セッション状態確認API（`getCheckoutSessionStatus.ts`）

### フェーズ4: 最も重要なアクティベーションAPIの実装

1. アクティベーションAPI（`activateFromSession.ts`）
2. purchaseFlowとの連携（Lambda to Lambda呼び出し）
3. エラーハンドリング
4. 統合テスト

**注**: 冪等性チェックはpurchaseFlow側で実装されるため、このAPI自体には冪等性ロジックは不要です。

### フェーズ5: 監視とアラートの設定

1. CloudWatch Metricsの設定
2. アラートの設定
3. ダッシュボードの作成

---

## まとめ

このドキュメントでは、プラン購入フローのバックエンドAPIについて、以下の5つのAPIの実装方針を説明しました。

1. **プラン一覧取得API**: ユーザが選択できるプランを取得
2. **Checkout Session作成API**: Stripe支払いフォームを開くための情報を取得（既存関数・エンドポイント変更のみ）
3. **セッション状態確認API**: 支払いが成功したか確認
4. **プランアクティベーションAPI**: 支払い完了後、即座にプランを有効化（最重要）
5. **現在のプラン情報取得API**: ユーザの現在のプラン状態を取得

特に重要なのは**プランアクティベーションAPI**です。このAPIにより、ユーザは支払い完了後すぐにプランの機能を利用開始できます。

### 設計の重要なポイント

**責務の明確な分離**:

- アクティベーションAPIは、認証・パラメータ検証・purchaseFlow呼び出しのみを担当します
- 冪等性チェックを含むビジネスロジックは、すべてpurchaseFlow（Orchestration層）で実装されます
- この設計により、API層とOrchestration層の責務が明確に分離され、保守性が向上します

**確実性の保証**:

- purchaseFlow内の冪等性チェックにより、return_url経由とWebhook経由の両方が実行されても、処理が重複しません
- どちらか一方が失敗しても、最終的には必ずプランが有効化される仕組みを実現します

次のステップとして、これらのAPIを順番に実装し、テストを行い、本番環境にデプロイすることで、ユーザにとって快適な購入体験を提供できます。
