# API 統合ガイド

## 概要

本ドキュメントでは、既存のLambda関数やAPIに認可システムを統合する具体的な方法を説明します。実装コード例とベストプラクティスを提供します。

## Lambda Authorizer の実装

### 基本構造

```typescript
// packages/cdk/lambda/authorizer/authorization-authorizer.ts
import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult
} from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { OpenFGAClient } from '@openfga/sdk';
import { SpiceDBClient } from '@authzed/authzed-node';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// 環境変数
const {
  COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID,
  AUTHZ_PROVIDER, // 'openfga' | 'spicedb' | 'both'
  OPENFGA_API_URL,
  SPICEDB_ENDPOINT,
  DYNAMODB_PLAN_TABLE,
  DYNAMODB_USAGE_TABLE,
} = process.env;

// クライアント初期化
const cognitoVerifier = CognitoJwtVerifier.create({
  userPoolId: COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: COGNITO_CLIENT_ID!,
});

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// 認可クライアント（遅延初期化）
let openFGAClient: OpenFGAClient | null = null;
let spiceDBClient: SpiceDBClient | null = null;

function getOpenFGAClient(): OpenFGAClient {
  if (!openFGAClient) {
    openFGAClient = new OpenFGAClient({
      apiUrl: OPENFGA_API_URL!,
    });
  }
  return openFGAClient;
}

function getSpiceDBClient(): SpiceDBClient {
  if (!spiceDBClient) {
    spiceDBClient = SpiceDBClient.create(SPICEDB_ENDPOINT!);
  }
  return spiceDBClient;
}

// メインハンドラー
export async function handler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  console.log('Authorization request:', JSON.stringify(event, null, 2));

  try {
    // 1. JWT トークン検証
    const token = extractToken(event);
    const payload = await cognitoVerifier.verify(token);

    const userId = payload.sub;
    const tenantId = payload['custom:tenant_id'] as string;
    const isTenantAdmin = payload['custom:tenantAdmin'] === 'true';

    console.log(`User: ${userId}, Tenant: ${tenantId}, Admin: ${isTenantAdmin}`);

    // 2. リソース情報の抽出
    const resourceInfo = extractResourceInfo(event);

    // 3. プラン情報の取得
    const planInfo = await getPlanInfo(tenantId);

    // 4. 認可チェック
    const authzDecision = await performAuthorizationCheck({
      userId,
      tenantId,
      isTenantAdmin,
      planInfo,
      resourceInfo,
    });

    // 5. IAM Policy生成
    const policy = generatePolicy(
      userId,
      authzDecision.effect,
      event.methodArn,
      {
        tenantId,
        userId,
        planId: planInfo.plan_id,
        resourceType: resourceInfo.type,
        resourceId: resourceInfo.id,
      }
    );

    // 6. メトリクス記録
    await recordMetrics(authzDecision);

    return policy;
  } catch (error) {
    console.error('Authorization error:', error);
    return generatePolicy('unknown', 'Deny', event.methodArn);
  }
}

// トークン抽出
function extractToken(event: APIGatewayRequestAuthorizerEvent): string {
  const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    throw new Error('Invalid authorization header format');
  }

  return match[1];
}

// リソース情報の抽出
interface ResourceInfo {
  type: string; // 'conversation' | 'document' | 'usecase' | 'model' | 'admin_operation'
  id: string;
  action: string; // 'view' | 'edit' | 'delete' | 'execute'
}

function extractResourceInfo(event: APIGatewayRequestAuthorizerEvent): ResourceInfo {
  const path = event.path || event.requestContext?.resourcePath || '';
  const method = event.httpMethod || event.requestContext?.httpMethod || 'GET';

  // パスからリソースタイプとIDを抽出
  // 例: /api/chat/conversations/123 -> { type: 'conversation', id: '123' }
  const pathParts = path.split('/').filter(Boolean);

  if (pathParts.includes('conversations')) {
    const conversationId = pathParts[pathParts.indexOf('conversations') + 1];
    return {
      type: 'conversation',
      id: conversationId || 'new',
      action: methodToAction(method),
    };
  }

  if (pathParts.includes('documents')) {
    const documentId = pathParts[pathParts.indexOf('documents') + 1];
    return {
      type: 'document',
      id: documentId || 'new',
      action: methodToAction(method),
    };
  }

  if (pathParts.includes('admin')) {
    return {
      type: 'admin_operation',
      id: pathParts.join('_'),
      action: 'execute',
    };
  }

  // デフォルト: ユースケース実行
  return {
    type: 'usecase',
    id: pathParts[pathParts.length - 1] || 'chat',
    action: 'execute',
  };
}

function methodToAction(method: string): string {
  switch (method) {
    case 'GET':
      return 'view';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'edit';
    case 'DELETE':
      return 'delete';
    default:
      return 'execute';
  }
}

// プラン情報取得
interface PlanInfo {
  plan_id: string;
  plan_name: string;
  permissions: {
    usecases: Record<string, boolean>;
    models: Record<string, { allowed: boolean; daily_quota: number }>;
  };
}

async function getPlanInfo(tenantId: string): Promise<PlanInfo> {
  const result = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_PLAN_TABLE,
      Key: { tenant_id: tenantId },
    })
  );

  if (!result.Item) {
    // デフォルトでFreeプラン
    return {
      plan_id: 'free',
      plan_name: 'Free',
      permissions: {
        usecases: { chat: true },
        models: {
          'claude-3-haiku': { allowed: true, daily_quota: 10 },
        },
      },
    };
  }

  return result.Item as PlanInfo;
}

// 認可チェック実行
interface AuthzCheckParams {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
  planInfo: PlanInfo;
  resourceInfo: ResourceInfo;
}

interface AuthzDecision {
  effect: 'Allow' | 'Deny';
  reason: string;
  latency_ms: number;
  provider: string;
}

async function performAuthorizationCheck(
  params: AuthzCheckParams
): Promise<AuthzDecision> {
  const startTime = Date.now();

  try {
    // 管理者操作の場合、テナント管理者権限をチェック
    if (params.resourceInfo.type === 'admin_operation') {
      if (params.isTenantAdmin) {
        return {
          effect: 'Allow',
          reason: 'Tenant admin privilege',
          latency_ms: Date.now() - startTime,
          provider: 'cognito',
        };
      } else {
        return {
          effect: 'Deny',
          reason: 'Not a tenant admin',
          latency_ms: Date.now() - startTime,
          provider: 'cognito',
        };
      }
    }

    // ユースケース実行の場合、プラン権限とクォータをチェック
    if (params.resourceInfo.type === 'usecase') {
      return await checkUsecasePermission(params, startTime);
    }

    // リソースアクセスの場合、認可DBに問い合わせ
    if (AUTHZ_PROVIDER === 'openfga' || AUTHZ_PROVIDER === 'both') {
      return await checkWithOpenFGA(params, startTime);
    } else {
      return await checkWithSpiceDB(params, startTime);
    }
  } catch (error) {
    console.error('Authorization check error:', error);
    return {
      effect: 'Deny',
      reason: `Authorization error: ${error}`,
      latency_ms: Date.now() - startTime,
      provider: 'error',
    };
  }
}

// OpenFGA による認可チェック
async function checkWithOpenFGA(
  params: AuthzCheckParams,
  startTime: number
): Promise<AuthzDecision> {
  const client = getOpenFGAClient();

  const { allowed } = await client.check({
    user: `user:${params.userId}`,
    relation: params.resourceInfo.action,
    object: `${params.resourceInfo.type}:${params.resourceInfo.id}`,
  });

  return {
    effect: allowed ? 'Allow' : 'Deny',
    reason: allowed ? 'Permission granted by OpenFGA' : 'Permission denied by OpenFGA',
    latency_ms: Date.now() - startTime,
    provider: 'openfga',
  };
}

// SpiceDB による認可チェック
async function checkWithSpiceDB(
  params: AuthzCheckParams,
  startTime: number
): Promise<AuthzDecision> {
  const client = getSpiceDBClient();

  const result = await client.checkPermission({
    resource: {
      objectType: params.resourceInfo.type,
      objectId: params.resourceInfo.id,
    },
    permission: params.resourceInfo.action,
    subject: {
      object: {
        objectType: 'user',
        objectId: params.userId,
      },
    },
  });

  const allowed = result.permissionship === 'PERMISSIONSHIP_HAS_PERMISSION';

  return {
    effect: allowed ? 'Allow' : 'Deny',
    reason: allowed ? 'Permission granted by SpiceDB' : 'Permission denied by SpiceDB',
    latency_ms: Date.now() - startTime,
    provider: 'spicedb',
  };
}

// ユースケース権限チェック（プラン + クォータ）
async function checkUsecasePermission(
  params: AuthzCheckParams,
  startTime: number
): Promise<AuthzDecision> {
  const usecaseId = params.resourceInfo.id;

  // プランでユースケースが許可されているか
  if (!params.planInfo.permissions.usecases[usecaseId]) {
    return {
      effect: 'Deny',
      reason: `Usecase ${usecaseId} not allowed in plan ${params.planInfo.plan_id}`,
      latency_ms: Date.now() - startTime,
      provider: 'plan',
    };
  }

  // モデル使用量チェック（query parameterから取得）
  // 実際の実装ではリクエストbodyやheaderから取得
  const model = 'claude-3-haiku'; // デフォルト

  const quota = params.planInfo.permissions.models[model];
  if (!quota || !quota.allowed) {
    return {
      effect: 'Deny',
      reason: `Model ${model} not allowed in plan`,
      latency_ms: Date.now() - startTime,
      provider: 'plan',
    };
  }

  // クォータチェック
  const usage = await getCurrentUsage(params.tenantId, model);
  if (usage >= quota.daily_quota) {
    return {
      effect: 'Deny',
      reason: `Daily quota exceeded for model ${model} (${usage}/${quota.daily_quota})`,
      latency_ms: Date.now() - startTime,
      provider: 'quota',
    };
  }

  return {
    effect: 'Allow',
    reason: 'Usecase and quota check passed',
    latency_ms: Date.now() - startTime,
    provider: 'plan',
  };
}

// 現在の使用量取得
async function getCurrentUsage(tenantId: string, model: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const result = await dynamoDB.send(
    new GetCommand({
      TableName: DYNAMODB_USAGE_TABLE,
      Key: {
        pk: `${tenantId}#model`,
        sk: `${today}#${model}`,
      },
    })
  );

  return result.Item?.count || 0;
}

// IAM Policy 生成
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: context || {},
  };
}

// メトリクス記録
async function recordMetrics(decision: AuthzDecision): Promise<void> {
  // CloudWatch Metrics に送信（実装例）
  console.log('Metrics:', {
    MetricName: 'AuthorizationDecision',
    Value: decision.effect === 'Allow' ? 1 : 0,
    Unit: 'Count',
    Dimensions: [
      { Name: 'Provider', Value: decision.provider },
      { Name: 'Effect', Value: decision.effect },
    ],
  });

  console.log('Metrics:', {
    MetricName: 'AuthorizationLatency',
    Value: decision.latency_ms,
    Unit: 'Milliseconds',
    Dimensions: [{ Name: 'Provider', Value: decision.provider }],
  });
}
```

## Backend API Lambda の変更

既存のAPI Lambda関数に使用量トラッキングイベントを追加します。

### Chat API の例

```typescript
// packages/cdk/lambda/bedrock-chat-proxy.ts (既存ファイル)
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

export async function handler(event: any) {
  // Authorizerから渡されたcontext情報
  const tenantId = event.requestContext.authorizer.tenantId;
  const userId = event.requestContext.authorizer.userId;
  const planId = event.requestContext.authorizer.planId;

  // リクエストボディからモデル情報取得
  const body = JSON.parse(event.body);
  const model = body.model || 'claude-3-haiku';

  try {
    // 既存のチャット処理
    const response = await invokeBedrockModel(model, body.messages);

    // 使用量イベントを送信
    await recordUsageEvent({
      tenantId,
      userId,
      planId,
      resourceType: 'usecase',
      resourceId: 'chat',
      model,
      timestamp: Date.now(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Chat API error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

// 使用量イベント送信
async function recordUsageEvent(params: {
  tenantId: string;
  userId: string;
  planId: string;
  resourceType: string;
  resourceId: string;
  model: string;
  timestamp: number;
}): Promise<void> {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'genai.usage',
          DetailType: 'UsageEvent',
          Detail: JSON.stringify(params),
          EventBusName: 'default',
        },
      ],
    })
  );
}
```

## Usage Tracker Lambda の実装

EventBridge経由で使用量を記録するLambda関数。

```typescript
// packages/cdk/lambda/usage-tracker/track-usage.ts
import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

const {
  DYNAMODB_USAGE_TABLE,
  QUOTA_ALERT_TOPIC_ARN,
} = process.env;

interface UsageEvent {
  tenantId: string;
  userId: string;
  planId: string;
  resourceType: string;
  resourceId: string;
  model: string;
  timestamp: number;
}

export async function handler(event: EventBridgeEvent<'UsageEvent', UsageEvent>) {
  console.log('Usage event:', JSON.stringify(event, null, 2));

  const usageEvent = event.detail;
  const today = new Date(usageEvent.timestamp).toISOString().split('T')[0];

  try {
    // DynamoDB カウンター更新
    const result = await dynamoDB.send(
      new UpdateCommand({
        TableName: DYNAMODB_USAGE_TABLE,
        Key: {
          pk: `${usageEvent.tenantId}#${usageEvent.resourceType}`,
          sk: `${today}#${usageEvent.model}`,
        },
        UpdateExpression:
          'ADD #count :inc SET #tenantId = :tenantId, #userId = :userId, #planId = :planId, #lastUpdate = :timestamp',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#tenantId': 'tenant_id',
          '#userId': 'last_user_id',
          '#planId': 'plan_id',
          '#lastUpdate': 'last_update',
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':tenantId': usageEvent.tenantId,
          ':userId': usageEvent.userId,
          ':planId': usageEvent.planId,
          ':timestamp': usageEvent.timestamp,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    const currentCount = result.Attributes?.count || 0;

    // クォータ制限取得
    const quotaLimit = await getQuotaLimit(usageEvent.planId, usageEvent.model);

    // クォータ超過チェック
    if (currentCount >= quotaLimit) {
      await sendQuotaAlert(usageEvent.tenantId, usageEvent.model, currentCount, quotaLimit);
    }

    // クォータの90%に達したら警告
    if (currentCount >= quotaLimit * 0.9 && currentCount < quotaLimit) {
      await sendQuotaWarning(usageEvent.tenantId, usageEvent.model, currentCount, quotaLimit);
    }

    console.log(`Usage updated: ${usageEvent.tenantId} - ${usageEvent.model}: ${currentCount}/${quotaLimit}`);
  } catch (error) {
    console.error('Failed to track usage:', error);
    throw error;
  }
}

// クォータ制限取得
async function getQuotaLimit(planId: string, model: string): Promise<number> {
  // DynamoDBのPlanPermissionsテーブルから取得
  // 簡略化のためハードコード
  const quotas: Record<string, Record<string, number>> = {
    free: { 'claude-3-haiku': 10 },
    pro: { 'claude-3-haiku': 100, 'claude-3-sonnet': 50, 'gpt-4': 20 },
    enterprise: { 'claude-3-haiku': 999999, 'claude-3-sonnet': 999999 },
  };

  return quotas[planId]?.[model] || 0;
}

// クォータ超過アラート送信
async function sendQuotaAlert(
  tenantId: string,
  model: string,
  currentCount: number,
  quotaLimit: number
): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: QUOTA_ALERT_TOPIC_ARN,
      Subject: `[Alert] Quota Exceeded - ${tenantId}`,
      Message: JSON.stringify({
        tenantId,
        model,
        currentCount,
        quotaLimit,
        severity: 'high',
        timestamp: Date.now(),
      }),
    })
  );
}

// クォータ警告送信
async function sendQuotaWarning(
  tenantId: string,
  model: string,
  currentCount: number,
  quotaLimit: number
): Promise<void> {
  console.log(`Quota warning: ${tenantId} - ${model} at ${currentCount}/${quotaLimit} (90%)`);
  // 必要に応じてSNS通知やメール送信
}
```

## Web フロントエンドの変更

### API 呼び出し時のエラーハンドリング

```typescript
// packages/web/src/hooks/useChat.ts
async function sendMessage(message: string, model: string) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getIdToken()}`,
      },
      body: JSON.stringify({ message, model }),
    });

    if (response.status === 403) {
      const error = await response.json();

      // クォータ超過エラー
      if (error.reason?.includes('quota exceeded')) {
        throw new QuotaExceededError(
          `本日の${model}の使用上限に達しました。明日またはアップグレードしてください。`
        );
      }

      // プラン制限エラー
      if (error.reason?.includes('not allowed in plan')) {
        throw new PlanRestrictionError(
          `現在のプランでは${model}を使用できません。プランをアップグレードしてください。`
        );
      }

      // その他の認可エラー
      throw new AuthorizationError('このリソースにアクセスする権限がありません。');
    }

    if (!response.ok) {
      throw new Error('API request failed');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // クォータ超過UI表示
      showQuotaExceededDialog(model);
    } else if (error instanceof PlanRestrictionError) {
      // プランアップグレードUI表示
      showUpgradeDialog();
    } else {
      // 一般的なエラー
      console.error('Chat error:', error);
    }
    throw error;
  }
}
```

### クォータ表示 UI コンポーネント

```typescript
// packages/web/src/components/QuotaDisplay.tsx
import React, { useEffect, useState } from 'react';

interface QuotaInfo {
  model: string;
  current: number;
  limit: number;
}

export const QuotaDisplay: React.FC = () => {
  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);

  useEffect(() => {
    // クォータ情報を定期的に取得
    const fetchQuotas = async () => {
      const response = await fetch('/api/quota', {
        headers: {
          'Authorization': `Bearer ${getIdToken()}`,
        },
      });
      const data = await response.json();
      setQuotas(data.quotas);
    };

    fetchQuotas();
    const interval = setInterval(fetchQuotas, 60000); // 1分ごと

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="quota-display">
      <h3>本日の使用量</h3>
      {quotas.map((quota) => (
        <div key={quota.model} className="quota-item">
          <span>{quota.model}</span>
          <div className="quota-bar">
            <div
              className="quota-fill"
              style={{
                width: `${(quota.current / quota.limit) * 100}%`,
                backgroundColor: getQuotaColor(quota.current, quota.limit),
              }}
            />
          </div>
          <span>{quota.current} / {quota.limit}</span>
        </div>
      ))}
    </div>
  );
};

function getQuotaColor(current: number, limit: number): string {
  const percentage = (current / limit) * 100;
  if (percentage >= 100) return '#dc2626'; // red
  if (percentage >= 90) return '#f59e0b';  // orange
  if (percentage >= 70) return '#eab308';  // yellow
  return '#10b981'; // green
}
```

## CDK での統合

### API Gateway に Authorizer を追加

```typescript
// packages/cdk/lib/generative-ai-use-cases-stack.ts
import { AuthorizationSystem } from './construct/authorization/authorization-system';
import { RequestAuthorizer } from 'aws-cdk-lib/aws-apigateway';

export class GenerativeAiUseCasesStack extends Stack {
  constructor(scope: Construct, id: string, props: GenerativeAiUseCasesStackProps) {
    super(scope, id, props);

    // 認可システム構築
    const authzSystem = new AuthorizationSystem(this, 'AuthorizationSystem', {
      userPool: auth.userPool,
      authzProvider: process.env.AUTHZ_PROVIDER || 'openfga',
      enableOpenFGA: true,
      enableSpiceDB: true,
    });

    // Lambda Authorizer作成
    const authorizer = new RequestAuthorizer(this, 'APIAuthorizer', {
      handler: authzSystem.authorizerFunction,
      identitySources: [IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5),
    });

    // 既存APIに適用
    const api = new RestApi(this, 'API', {
      defaultMethodOptions: {
        authorizer,
        authorizationType: AuthorizationType.CUSTOM,
      },
    });

    // 各エンドポイント定義
    const chatResource = api.root.addResource('chat');
    chatResource.addMethod('POST', new LambdaIntegration(chatLambda));

    // EventBridge で UsageTracker に接続
    const usageRule = new Rule(this, 'UsageTrackingRule', {
      eventPattern: {
        source: ['genai.usage'],
        detailType: ['UsageEvent'],
      },
    });

    usageRule.addTarget(new LambdaFunction(authzSystem.usageTrackerFunction));
  }
}
```

## テスト

### 単体テスト

```typescript
// packages/cdk/lambda/authorizer/authorization-authorizer.test.ts
import { handler } from './authorization-authorizer';

describe('Authorization Authorizer', () => {
  it('should allow access with valid token and permissions', async () => {
    const event = {
      type: 'REQUEST',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/prod/POST/chat',
      headers: {
        'Authorization': 'Bearer valid-token',
      },
      path: '/api/chat',
      httpMethod: 'POST',
    };

    const result = await handler(event as any);

    expect(result.principalId).toBeTruthy();
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
  });

  it('should deny access when quota exceeded', async () => {
    // テスト実装
  });
});
```

### 統合テスト

```bash
# API Gateway エンドポイントへのリクエスト
curl -X POST https://api.example.com/chat \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "model": "claude-3-haiku"}'
```

## 次のステップ

- [プラン・クォータ管理](./authorization-plan-quota.md): 運用ガイド
