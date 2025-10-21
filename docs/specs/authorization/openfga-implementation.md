# OpenFGA 実装ガイド

AWS CDK を使用した OpenFGA のプロダクション対応デプロイメントガイド

## 目次

1. [概要](#概要)
2. [CDK Constructs](#cdk-constructs)
3. [Lambda Authorizer 実装](#lambda-authorizer-実装)
4. [Admin API 設計](#admin-api-設計)
5. [DynamoDB テーブル設計](#dynamodb-テーブル設計)
6. [統合テスト](#統合テスト)

## 概要

このモジュールは、ECS Fargate 上に OpenFGA をデプロイするためのプロダクション対応 CDK Constructs を提供します。

### 提供コンポーネント

- **OpenFGA Service** - ECS Fargate 上で動作する OpenFGA サービス（オートスケーリング対応）
- **RDS PostgreSQL** - 暗号化とバックアップが有効なデータベース
- **Application Load Balancer** - HTTP (8080) と gRPC (8081) エンドポイント
- **Lambda Authorizer** - API Gateway 統合型の認可チェック
- **CloudWatch** - ログとメトリクス統合

## CDK Constructs

### Quick Start

```typescript
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { OpenFGADatabase, OpenFGAService } from './construct/openfga';

// Get or create VPC
const vpc = Vpc.fromLookup(this, 'VPC', { isDefault: true });

// Create PostgreSQL database
const database = new OpenFGADatabase(this, 'Database', {
  vpc,
  environment: 'production',
  multiAz: true,
  instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
});

// Create OpenFGA service
const openFGA = new OpenFGAService(this, 'Service', {
  vpc,
  database,
  environment: 'production',
  desiredCount: 3,
  minCapacity: 2,
  maxCapacity: 10,
});

// Output endpoints
new CfnOutput(this, 'Endpoint', {
  value: openFGA.endpoint,
});
```

## Architecture

```
┌─────────────────┐
│  Lambda/ECS     │
│  Applications   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│       ALB       │─────▶│ ECS Fargate      │
│  (HTTP + gRPC)  │      │ - OpenFGA Tasks  │
│                 │      │ - Auto-scaling   │
└─────────────────┘      └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ RDS PostgreSQL   │
                         │ - Encrypted      │
                         │ - Multi-AZ (opt) │
                         └──────────────────┘
```

## Components

### OpenFGADatabase

Creates a managed RDS PostgreSQL instance optimized for OpenFGA.

**Features:**
- PostgreSQL 15.4 (OpenFGA compatible)
- Encryption at rest
- Automated backups (7 days retention)
- Performance Insights enabled
- CloudWatch Logs integration
- Multi-AZ deployment (optional)

**Configuration:**
```typescript
const database = new OpenFGADatabase(this, 'Database', {
  vpc,
  environment: 'production',

  // Instance sizing
  instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
  allocatedStorageGb: 20,

  // High availability
  multiAz: true,
  backupRetentionDays: 7,

  // Security
  deletionProtection: true,
});
```

### OpenFGAService

Deploys OpenFGA on ECS Fargate with Application Load Balancer.

**Features:**
- ECS Fargate serverless compute
- Application Load Balancer (HTTP:8080, gRPC:8081)
- Auto-scaling based on CPU/memory
- Health checks and monitoring
- Pre-shared key authentication
- Check query caching (5m TTL)

**Configuration:**
```typescript
const openFGA = new OpenFGAService(this, 'Service', {
  vpc,
  database,
  environment: 'production',

  // Task sizing
  cpu: 512,              // 0.5 vCPU
  memoryLimitMiB: 1024,  // 1 GB

  // Scaling
  desiredCount: 3,
  minCapacity: 2,
  maxCapacity: 10,

  // OpenFGA version
  imageTag: 'v1.5.0',

  // Security
  publicLoadBalancer: false,
  enablePlayground: false,
});
```

## Cost Estimation

### POC/Development Environment
- ECS Fargate (2 tasks × 0.25 vCPU): $18/month
- RDS db.t4g.micro: $15/month
- ALB: $16/month
- **Total: ~$49/month**

### Production Environment
- ECS Fargate (3-5 tasks × 0.5 vCPU): $54-90/month
- RDS db.t4g.small (Multi-AZ): $60/month
- ALB: $16/month
- **Total: ~$130-166/month**

**Savings vs SpiceDB+EKS: 70-75%**

## Usage with Lambda Authorizer

```typescript
import { AuthorizationSystem } from '../authorization/authorization-system';

const authSystem = new AuthorizationSystem(this, 'Auth', {
  userPool: cognito.userPool,
  openFGAEndpoint: openFGA.endpoint,
  openFGAStoreId: process.env.OPENFGA_STORE_ID!,
  openFGAKeySecretArn: openFGA.presharedKeysSecret.secretArn,
  vpc,
});

// Use with API Gateway
const api = new RestApi(this, 'Api', {
  defaultMethodOptions: {
    authorizer: new RequestAuthorizer(this, 'Authorizer', {
      handler: authSystem.authorizerFunction,
      identitySources: ['method.request.header.Authorization'],
    }),
  },
});
```

## Schema Management

### 1. Create Authorization Model

```bash
# Create store
fga store create --name "my-app" --api-url http://alb-endpoint:8080

# Write schema
fga model write \
  --store-id $STORE_ID \
  --file authorization-schema.fga \
  --api-url http://alb-endpoint:8080
```

### 2. Write Relationship Tuples

```bash
# Grant user membership
fga tuple write \
  --store-id $STORE_ID \
  user:alice tenant:acme#member

# Assign plan
fga tuple write \
  --store-id $STORE_ID \
  tenant:acme plan:pro#subscriber
```

### 3. Check Permissions

```bash
# Can user execute usecase?
fga query check \
  --store-id $STORE_ID \
  user:alice execute usecase:chat
```

## Authorization Model: Hybrid ToC/ToB Support

The authorization schema supports both **To-Consumer (ToC)** and **To-Business (ToB)** models with entitlement-based permissions.

### Business Models

#### ToC (To Consumer)
- Individual users subscribe to plans directly
- Users can exist without tenant membership (free tier)
- Users can optionally belong to tenants
- Permissions come from user's own plan subscription

#### ToB (To Business)
- Tenant subscribes to organization-wide plan
- Tenant admins assign entitlements to specific users
- Users don't subscribe to plans themselves
- Permissions come from tenant plan + admin assignments

#### Hybrid
- Users can have BOTH direct plan subscription AND tenant membership
- Permissions use additive union (most permissive)
- Tenant admins can explicitly deny specific capabilities

### Core Concepts

#### Entitlements
Entitlements are first-class objects representing specific capabilities. They can be granted through:
1. User's own plan subscription (ToC)
2. Tenant's plan subscription (ToB)
3. Direct admin assignment (ToB targeted grants)
4. Plan inheritance (bundling)

#### Permission Resolution
Permissions use **additive union** - a user has access if ANY source grants it:
- User plan subscription
- Tenant plan subscription
- Admin-assigned entitlement
- Plan inheritance

Tenant admins can override with **explicit deny** that blocks access regardless of other sources.

### Usage Scenarios

#### Scenario 1: ToC Standalone User (Free Tier)

```bash
# User alice subscribes to free plan
fga tuple write user:alice plan:free#user_subscriber

# Free plan provides chat entitlement
fga tuple write plan:free entitlement:usecase_chat#entitles
fga tuple write entitlement:usecase_chat plan:free#via_user_plan

# Link entitlement to capability
fga tuple write usecase_capability:chat entitlement:usecase_chat#entitlement

# Check permission
fga query check user:alice can_execute usecase_capability:chat
# ✓ Allowed via user's free plan
```

#### Scenario 2: ToC User with Tenant (Hybrid)

```bash
# User bob has personal pro plan
fga tuple write user:bob plan:pro#user_subscriber
fga tuple write plan:pro entitlement:usecase_rag#entitles
fga tuple write entitlement:usecase_rag plan:pro#via_user_plan

# Bob also belongs to tenant with enterprise plan
fga tuple write user:bob tenant:acme#member
fga tuple write tenant:acme plan:enterprise#plan_subscription
fga tuple write tenant:acme plan:enterprise#tenant_subscriber
fga tuple write plan:enterprise entitlement:model_opus#entitles
fga tuple write entitlement:model_opus plan:enterprise#via_tenant_plan

# Link to capabilities
fga tuple write usecase_capability:rag entitlement:usecase_rag#entitlement
fga tuple write model_capability:claude-opus entitlement:model_opus#entitlement

# Bob gets permissions from BOTH sources
fga query check user:bob can_execute usecase_capability:rag
# ✓ Allowed via personal pro plan

fga query check user:bob can_execute model_capability:claude-opus
# ✓ Allowed via tenant enterprise plan
```

#### Scenario 3: ToB Admin Grant

```bash
# Tenant has basic plan
fga tuple write tenant:acme plan:basic#plan_subscription

# Admin grants chat to specific user charlie
fga tuple write user:charlie tenant:acme#member
fga tuple write tenant_entitlement:acme/charlie/chat tenant:acme#tenant
fga tuple write tenant_entitlement:acme/charlie/chat user:charlie#grantee
fga tuple write entitlement:usecase_chat tenant_entitlement:acme/charlie/chat#via_tenant_assignment
fga tuple write usecase_capability:chat entitlement:usecase_chat#entitlement

# Check permission
fga query check user:charlie can_execute usecase_capability:chat
# ✓ Allowed via admin assignment
```

#### Scenario 4: Explicit Deny

```bash
# Tenant provides image generation
fga tuple write plan:enterprise entitlement:usecase_image_gen#entitles
fga tuple write entitlement:usecase_image_gen plan:enterprise#via_tenant_plan

# Admin explicitly blocks user dave
fga tuple write tenant_entitlement:acme/dave/block tenant:acme#tenant
fga tuple write tenant_entitlement:acme/dave/block user:dave#blocked
fga tuple write usecase_capability:image_generation tenant_entitlement:acme/dave/block#blocked_by_tenant

# Check permission
fga query check user:dave can_execute usecase_capability:image_generation
# ✗ Denied - explicit block overrides tenant plan
```

### Quota Management

The schema supports two-level quota enforcement:
- **Tenant Pool**: Organization-wide quota limit
- **Individual Limits**: Per-user quotas set by admin

Both conditions must be satisfied for access.

```bash
# Set individual quota for user eve
fga tuple write quota_grant:acme/eve/opus user:eve#user
fga tuple write quota_grant:acme/eve/opus tenant:acme#tenant
fga tuple write quota_grant:acme/eve/opus model_capability:claude-opus#model

# Check with quota context
fga query check \
  user:eve \
  can_execute \
  model_capability:claude-opus \
  --context '{"user_current_usage":8,"user_quota_limit":10,"tenant_current_usage":75,"tenant_quota_limit":100}'
# ✓ Allowed (8 < 10 AND 75 < 100)
```

### Plan Inheritance

Higher-tier plans can include all features from lower tiers:

```bash
# Enterprise includes Pro features
fga tuple write plan:enterprise plan:pro#includes
fga tuple write plan:pro entitlement:usecase_rag#entitles
fga tuple write plan:pro entitlement:model_sonnet#entitles
fga tuple write plan:enterprise entitlement:model_opus#entitles

# User with enterprise plan gets:
# - model_opus (direct)
# - usecase_rag (via pro inheritance)
# - model_sonnet (via pro inheritance)
```

### Entitlement Types

The schema supports multi-level entitlements:

1. **Usecase Level**: Access to entire use cases (chat, rag, translation)
2. **Model Level**: Access to specific AI models (claude-3-sonnet, gpt-4)
3. **Resource Level**: Operations on resources (view, edit, delete documents/conversations)

Example entitlements:
- `entitlement:usecase_chat` - Chat use case access
- `entitlement:model_claude_sonnet` - Claude Sonnet model access
- `entitlement:document_upload` - Document upload capability
- `entitlement:api_access` - API access feature

### Admin Operations

Tenant admins can manage entitlements through dedicated APIs:

```typescript
// Grant entitlement to user
POST /admin/entitlements/grant
{
  "tenantId": "acme",
  "userId": "charlie",
  "entitlementId": "usecase_chat"
}

// Revoke entitlement
POST /admin/entitlements/revoke
{
  "tenantId": "acme",
  "userId": "charlie",
  "entitlementId": "usecase_chat"
}

// Explicit deny (block)
POST /admin/entitlements/block
{
  "tenantId": "acme",
  "userId": "dave",
  "capabilityId": "image_generation"
}

// Set individual quota
POST /admin/quotas/set-user-limit
{
  "tenantId": "acme",
  "userId": "eve",
  "modelId": "claude-opus",
  "dailyLimit": 10
}
```

### Schema File

The complete authorization schema is defined in `authorization-schema.fga`. See the file for:
- Detailed type definitions
- Permission resolution logic
- Comprehensive usage examples
- Migration notes from previous schema

## Monitoring

### CloudWatch Metrics

The service automatically publishes metrics to CloudWatch:

- `Authorization/OpenFGA/AuthorizationLatency` - Check latency
- `Authorization/OpenFGA/AuthorizationDecision` - Allow/Deny counts
- `Authorization/OpenFGA/QuotaExceeded` - Quota violations
- `Authorization/OpenFGA/OpenFGACheckLatency` - OpenFGA API latency

### CloudWatch Logs

Logs are sent to `/ecs/openfga-{environment}`:

```bash
# Tail logs
aws logs tail /ecs/openfga-production --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /ecs/openfga-production \
  --filter-pattern "ERROR"
```

### ECS Exec for Debugging

```bash
# Connect to running task
aws ecs execute-command \
  --cluster openfga-production \
  --task <task-id> \
  --container openfga \
  --command "/bin/sh" \
  --interactive
```

## Security Best Practices

### 1. Network Security

- Deploy Fargate tasks in **private subnets**
- Use **internal ALB** (not internet-facing)
- Restrict security groups to known sources
- Enable VPC Flow Logs

### 2. Authentication

- Use **pre-shared keys** from Secrets Manager
- Rotate keys periodically
- Never embed keys in code

### 3. Database Security

- Enable **encryption at rest** (KMS)
- Use **SSL/TLS** for connections
- Store credentials in Secrets Manager
- Enable **deletion protection** in production

### 4. Application Security

- **Disable playground** in production
- Enable **CloudWatch logging**
- Set up **CloudWatch Alarms**
- Use **least privilege** IAM roles

## Performance Tuning

### 1. Fargate Task Sizing

For typical workloads:
- **POC**: 256 CPU (0.25 vCPU), 512 MB memory
- **Production**: 512 CPU (0.5 vCPU), 1024 MB memory

### 2. Auto-Scaling

Default configuration:
- **CPU utilization**: Scale at 70%
- **Memory utilization**: Scale at 80%
- **Min capacity**: 2 tasks
- **Max capacity**: 10 tasks

### 3. Database Optimization

RDS parameters optimized for OpenFGA:
```
max_connections: 100
shared_buffers: 256MB
effective_cache_size: 768MB
work_mem: 4MB
```

### 4. Caching

OpenFGA check query cache:
- **Enabled**: true
- **TTL**: 5 minutes

## Troubleshooting

### High Latency

**Symptoms**: P95 > 100ms

**Solutions:**
1. Enable check query caching
2. Scale up Fargate tasks
3. Upgrade RDS instance type
4. Use RDS Proxy for connection pooling

### Database Connection Errors

**Symptoms**: "connection refused"

**Solutions:**
1. Check security group rules
2. Verify RDS endpoint in environment variables
3. Ensure tasks are in correct subnets
4. Check VPC routing tables

### Out of Memory (OOM)

**Symptoms**: Tasks restarting frequently

**Solutions:**
1. Increase `memoryLimitMiB` in task definition
2. Review OpenFGA memory usage in CloudWatch
3. Reduce `max_connections` in RDS

## Testing

See `scripts/` directory:

- `test-openfga.sh` - Functional authorization tests (18 test cases)
- `perf-test-openfga.js` - k6 performance tests

```bash
# Run functional tests
export OPENFGA_API_URL="http://your-alb:8080"
export OPENFGA_STORE_ID="your-store-id"
./scripts/test-openfga.sh

# Run performance tests
k6 run --vus 10 --duration 30s scripts/perf-test-openfga.js
```

## Migration from SpiceDB

See [OPENFGA_MIGRATION_PLAN.md](../../../../docs/ja/OPENFGA_MIGRATION_PLAN.md) for complete migration guide.

**Key differences:**
- Schema syntax (`.zed` → `.fga`)
- Caveats → Conditions
- Per-tenant namespaces → Per-tenant stores
- Relation chaining syntax

---

## Lambda Authorizer 実装

Lambda Authorizer は API Gateway のすべてのリクエストで認可チェックを実行する中核コンポーネントです。

### アーキテクチャ

```typescript
// packages/cdk/lambda/authorizer/authorization-authorizer.ts

/**
 * Lambda Authorizer のメインハンドラー
 *
 * 処理フロー:
 * 1. Cognito JWT トークン検証
 * 2. ユーザー・テナント情報抽出
 * 3. DynamoDB からクォータ使用量取得
 * 4. OpenFGA で権限チェック（クォータコンテキスト付き）
 * 5. IAM Policy 生成と返却
 */
export async function handler(
  event: APIGatewayAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  // 実装詳細は以下参照
}
```

### 環境変数設定

Lambda Authorizer に必要な環境変数は以下の通りです:

```typescript
// CDK スタックでの環境変数設定例
const authorizerFunction = new NodejsFunction(this, 'Authorizer', {
  environment: {
    // Cognito 設定
    COGNITO_USER_POOL_ID: props.userPool.userPoolId,
    COGNITO_CLIENT_ID: props.userPoolClientId,

    // OpenFGA 設定
    OPENFGA_API_URL: props.openFGAEndpoint,
    OPENFGA_STORE_ID: props.openFGAStoreId,
    OPENFGA_KEY_SECRET_ARN: props.openFGAKeySecretArn,

    // DynamoDB テーブル
    DYNAMODB_USER_QUOTA_TABLE: userQuotaTable.tableName,
    DYNAMODB_TENANT_QUOTA_TABLE: tenantQuotaTable.tableName,
    DYNAMODB_PLAN_TABLE: planTable.tableName,

    // キャッシュ設定
    CACHE_ENABLED: 'true',
    CACHE_TTL_SECONDS: '300',  // 5分

    // ログレベル
    LOG_LEVEL: 'INFO',
  },
});
```

### 処理フロー実装

#### 1. JWT トークン検証

```typescript
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

async function verifyToken(token: string): Promise<CognitoJWTPayload> {
  try {
    const payload = await verifier.verify(token);
    return {
      userId: payload.sub,
      tenantId: payload['custom:tenant_id'],
      email: payload.email,
    };
  } catch (error) {
    throw new Error('Invalid token');
  }
}
```

#### 2. API パスパーサー

API パスから権限チェック対象を判定します:

```typescript
interface ParsedApiPath {
  category: 'usecase' | 'model' | 'resource' | 'admin';
  resourceType?: 'conversation' | 'document';
  resourceId: string;
  permission?: 'view' | 'edit' | 'delete' | 'upload';
}

function parseApiPath(path: string, method: string): ParsedApiPath {
  // /chat → usecase:chat
  if (path === '/chat') {
    return { category: 'usecase', resourceId: 'chat' };
  }

  // /rag → usecase:rag
  if (path === '/rag') {
    return { category: 'usecase', resourceId: 'rag' };
  }

  // /models/{modelId} → model:{modelId}
  const modelMatch = path.match(/^\/models\/([^/]+)/);
  if (modelMatch) {
    return { category: 'model', resourceId: modelMatch[1] };
  }

  // /conversations/{id} → resource:conversation:{id}
  const conversationMatch = path.match(/^\/conversations\/([^/]+)/);
  if (conversationMatch) {
    return {
      category: 'resource',
      resourceType: 'conversation',
      resourceId: conversationMatch[1],
      permission: mapMethodToPermission(method),
    };
  }

  // /documents/{id} → resource:document:{id}
  const documentMatch = path.match(/^\/documents\/([^/]+)/);
  if (documentMatch) {
    return {
      category: 'resource',
      resourceType: 'document',
      resourceId: documentMatch[1],
      permission: mapMethodToPermission(method),
    };
  }

  // /admin/* → admin operations
  if (path.startsWith('/admin/')) {
    return { category: 'admin', resourceId: path };
  }

  throw new Error(`Unknown path: ${path}`);
}

function mapMethodToPermission(method: string): string {
  const mapping: Record<string, string> = {
    'GET': 'view',
    'POST': 'edit',
    'PUT': 'edit',
    'PATCH': 'edit',
    'DELETE': 'delete',
  };
  return mapping[method] || 'view';
}
```

#### 3. クォータコンテキスト構築

```typescript
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { QuotaContext } from './utils/openfgaClient';

const dynamodb = new DynamoDBClient({});

async function buildQuotaContext(
  userId: string,
  tenantId: string | undefined,
  modelId: string
): Promise<QuotaContext> {
  const today = new Date().toISOString().split('T')[0];

  // ユーザー個別クォータ取得
  const userQuotaResult = await dynamodb.send(
    new GetItemCommand({
      TableName: process.env.DYNAMODB_USER_QUOTA_TABLE!,
      Key: {
        user_id: { S: userId },
        model_date: { S: `${modelId}#${today}` },
      },
    })
  );

  const userCurrentUsage = parseInt(userQuotaResult.Item?.current_usage?.N || '0');
  const userQuotaLimit = parseInt(userQuotaResult.Item?.daily_limit?.N || '1000');

  // テナントクォータ取得（テナントメンバーの場合）
  let tenantCurrentUsage: number | undefined;
  let tenantQuotaLimit: number | undefined;

  if (tenantId) {
    const tenantQuotaResult = await dynamodb.send(
      new GetItemCommand({
        TableName: process.env.DYNAMODB_TENANT_QUOTA_TABLE!,
        Key: {
          tenant_id: { S: tenantId },
          model_date: { S: `${modelId}#${today}` },
        },
      })
    );

    tenantCurrentUsage = parseInt(tenantQuotaResult.Item?.current_usage?.N || '0');
    tenantQuotaLimit = parseInt(tenantQuotaResult.Item?.daily_limit?.N || '10000');
  }

  return {
    userCurrentUsage,
    userQuotaLimit,
    tenantCurrentUsage,
    tenantQuotaLimit,
  };
}
```

#### 4. メイン権限チェックロジック

```typescript
import {
  checkUsecasePermission,
  checkModelPermission,
  checkResourcePermission,
} from './utils/openfgaClient';

async function checkPermission(
  userId: string,
  tenantId: string | undefined,
  parsedPath: ParsedApiPath
): Promise<PermissionCheckResult> {
  // ユースケース権限チェック
  if (parsedPath.category === 'usecase') {
    return await checkUsecasePermission(userId, parsedPath.resourceId);
  }

  // モデル権限チェック（クォータ付き）
  if (parsedPath.category === 'model') {
    const quotaContext = await buildQuotaContext(
      userId,
      tenantId,
      parsedPath.resourceId
    );
    return await checkModelPermission(userId, parsedPath.resourceId, quotaContext);
  }

  // リソース権限チェック
  if (parsedPath.category === 'resource') {
    return await checkResourcePermission(
      userId,
      parsedPath.resourceType!,
      parsedPath.resourceId,
      parsedPath.permission!
    );
  }

  // Admin 権限チェック
  if (parsedPath.category === 'admin') {
    // テナント管理者権限確認
    if (!tenantId) {
      return { allowed: false, reason: 'not_tenant_member' };
    }

    // OpenFGA でテナント管理者かチェック
    const adminCheck = await checkResourcePermission(
      userId,
      'tenant',
      tenantId,
      'manage'
    );

    return adminCheck;
  }

  return { allowed: false, reason: 'unknown_category' };
}
```

#### 5. IAM Policy 生成

```typescript
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
```

#### 6. キャッシュ実装

```typescript
import NodeCache from 'node-cache';

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS || '300'),
  checkperiod: 60,
});

async function checkPermissionWithCache(
  userId: string,
  tenantId: string | undefined,
  parsedPath: ParsedApiPath
): Promise<PermissionCheckResult> {
  if (process.env.CACHE_ENABLED !== 'true') {
    return await checkPermission(userId, tenantId, parsedPath);
  }

  const cacheKey = `${userId}:${tenantId || 'no-tenant'}:${parsedPath.category}:${parsedPath.resourceId}`;

  // キャッシュから取得
  const cached = cache.get<PermissionCheckResult>(cacheKey);
  if (cached) {
    console.log(`Cache hit for ${cacheKey}`);
    return cached;
  }

  // OpenFGA チェック
  const result = await checkPermission(userId, tenantId, parsedPath);

  // 成功時のみキャッシュ（拒否は状況変化の可能性）
  if (result.allowed) {
    cache.set(cacheKey, result);
  }

  return result;
}
```

#### 7. メトリクス送信

```typescript
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({});

async function sendMetrics(
  checkResult: PermissionCheckResult,
  latencyMs: number,
  category: string
) {
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: 'Authorization/Authorizer',
      MetricData: [
        {
          MetricName: 'AuthorizationLatency',
          Value: latencyMs,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Category', Value: category },
            { Name: 'Result', Value: checkResult.allowed ? 'Allow' : 'Deny' },
          ],
        },
        {
          MetricName: 'AuthorizationDecision',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Decision', Value: checkResult.allowed ? 'Allow' : 'Deny' },
            { Name: 'Reason', Value: checkResult.reason || 'success' },
          ],
        },
      ],
    })
  );
}
```

#### 8. 完全なハンドラー実装

```typescript
export async function handler(
  event: APIGatewayAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  const startTime = Date.now();

  try {
    // 1. トークン検証
    const token = event.authorizationToken?.replace('Bearer ', '');
    if (!token) {
      throw new Error('No authorization token');
    }

    const jwtPayload = await verifyToken(token);
    const { userId, tenantId } = jwtPayload;

    // 2. API パス解析
    const parsedPath = parseApiPath(
      event.methodArn.split(':').pop()!.split('/').slice(3).join('/'),
      event.requestContext?.httpMethod || 'GET'
    );

    // 3. 権限チェック（キャッシュ付き）
    const checkResult = await checkPermissionWithCache(userId, tenantId, parsedPath);

    // 4. メトリクス送信
    const latency = Date.now() - startTime;
    await sendMetrics(checkResult, latency, parsedPath.category);

    // 5. IAM Policy 生成
    if (checkResult.allowed) {
      return generatePolicy(
        userId,
        'Allow',
        event.methodArn,
        {
          userId,
          tenantId: tenantId || '',
          category: parsedPath.category,
        }
      );
    } else {
      console.warn(`Permission denied for ${userId}: ${checkResult.reason}`);
      return generatePolicy(userId, 'Deny', event.methodArn);
    }
  } catch (error) {
    console.error('Authorizer error:', error);

    // エラー時は拒否
    return generatePolicy('unknown', 'Deny', event.methodArn);
  }
}
```

### Lambda Authorizer のテスト

```typescript
// packages/cdk/lambda/authorizer/__tests__/authorization-authorizer.test.ts

import { handler } from '../authorization-authorizer';
import { APIGatewayAuthorizerEvent } from 'aws-lambda';

describe('Authorization Authorizer', () => {
  it('should allow access to chat for user with permission', async () => {
    const event: APIGatewayAuthorizerEvent = {
      type: 'TOKEN',
      authorizationToken: 'Bearer valid-jwt-token',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/chat',
    };

    const result = await handler(event);

    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context.category).toBe('usecase');
  });

  it('should deny access when quota exceeded', async () => {
    const event: APIGatewayAuthorizerEvent = {
      type: 'TOKEN',
      authorizationToken: 'Bearer valid-jwt-token',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/models/claude-3-sonnet',
    };

    // Mock quota exceeded
    jest.spyOn(require('../utils/openfgaClient'), 'checkModelPermission')
      .mockResolvedValue({ allowed: false, reason: 'user_quota_exceeded' });

    const result = await handler(event);

    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});
```

---

## Admin API 設計

Admin API は、テナント管理者が Entitlement とクォータを管理するために使用します。

### API エンドポイント一覧

#### Entitlement 管理 API

##### 1. Entitlement 付与

```http
POST /admin/entitlements/grant
Content-Type: application/json
Authorization: Bearer <admin-jwt>

Request:
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "entitlementId": "usecase_chat"
}

Response (200 OK):
{
  "success": true,
  "entitlementId": "usecase_chat",
  "grantedAt": "2025-10-21T10:00:00Z"
}

Error (403 Forbidden):
{
  "error": "not_tenant_admin",
  "message": "User is not an admin of the specified tenant"
}
```

**実装例:**

```typescript
// packages/cdk/lambda/admin/grantEntitlement.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { grantTenantEntitlement } from '../utils/openfgaClient';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // 1. 管理者権限確認
    const adminUserId = event.requestContext.authorizer?.userId;
    const tenantId = JSON.parse(event.body!).tenantId;

    // Authorizer で既にテナント管理者確認済み（Admin API パス）

    // 2. リクエストパラメータ取得
    const { userId, entitlementId } = JSON.parse(event.body!);

    // 3. Entitlement 付与
    await grantTenantEntitlement(tenantId, userId, entitlementId);

    // 4. 監査ログ記録
    console.log(`Admin ${adminUserId} granted ${entitlementId} to ${userId} in ${tenantId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        entitlementId,
        grantedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('Grant entitlement error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: String(error) }),
    };
  }
}
```

##### 2. Entitlement 削除

```http
POST /admin/entitlements/revoke
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "entitlementId": "usecase_chat"
}

Response (200 OK):
{
  "success": true,
  "revokedAt": "2025-10-21T10:05:00Z"
}
```

##### 3. ユーザーブロック（明示的拒否）

```http
POST /admin/entitlements/block
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "capabilityType": "usecase",
  "capabilityId": "image_generation"
}

Response (200 OK):
{
  "success": true,
  "blockedAt": "2025-10-21T10:10:00Z"
}
```

##### 4. ブロック解除

```http
POST /admin/entitlements/unblock
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "capabilityType": "usecase",
  "capabilityId": "image_generation"
}

Response (200 OK):
{
  "success": true,
  "unblockedAt": "2025-10-21T10:15:00Z"
}
```

##### 5. ユーザーの Entitlement 一覧取得

```http
GET /admin/entitlements/list?userId=user123&tenantId=acme-corp

Response (200 OK):
{
  "entitlements": [
    {
      "id": "usecase_chat",
      "source": "tenant_plan",
      "grantedAt": "2025-10-01T00:00:00Z",
      "blocked": false
    },
    {
      "id": "model_claude_sonnet",
      "source": "admin_grant",
      "grantedAt": "2025-10-15T12:00:00Z",
      "blocked": false
    },
    {
      "id": "usecase_image_generation",
      "source": "user_plan",
      "grantedAt": "2025-10-01T00:00:00Z",
      "blocked": true,
      "blockedAt": "2025-10-20T15:00:00Z"
    }
  ]
}
```

**実装例:**

```typescript
// packages/cdk/lambda/admin/listUserEntitlements.ts
import { listUserPermissions } from '../utils/openfgaClient';

export async function handler(event: APIGatewayProxyEvent) {
  const { userId, tenantId } = event.queryStringParameters!;

  // OpenFGA から利用可能な Capability 取得
  const usecases = await listUserPermissions(userId, 'usecase');
  const models = await listUserPermissions(userId, 'model');

  // DynamoDB から Entitlement メタデータ取得（ソース、付与日時等）
  const entitlements = await getEntitlementMetadata(userId, tenantId);

  return {
    statusCode: 200,
    body: JSON.stringify({ entitlements }),
  };
}
```

#### クォータ管理 API

##### 1. ユーザー個別クォータ設定

```http
POST /admin/quotas/set-user-limit
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "modelId": "claude-3-sonnet",
  "dailyLimit": 50,
  "monthlyLimit": 1000
}

Response (200 OK):
{
  "success": true,
  "quotaLimits": {
    "dailyLimit": 50,
    "monthlyLimit": 1000
  },
  "setAt": "2025-10-21T10:20:00Z"
}
```

**実装例:**

```typescript
// packages/cdk/lambda/admin/setUserQuota.ts
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { setUserQuotaGrant } from '../utils/openfgaClient';

export async function handler(event: APIGatewayProxyEvent) {
  const { tenantId, userId, modelId, dailyLimit, monthlyLimit } = JSON.parse(event.body!);

  // 1. DynamoDB にクォータ上限保存
  const dynamodb = new DynamoDBClient({});
  await dynamodb.send(
    new PutItemCommand({
      TableName: process.env.DYNAMODB_USER_QUOTA_TABLE!,
      Item: {
        user_id: { S: userId },
        tenant_model: { S: `${tenantId}#${modelId}` },
        daily_limit: { N: String(dailyLimit) },
        monthly_limit: { N: String(monthlyLimit) },
        set_by_admin: { S: event.requestContext.authorizer?.userId },
        set_at: { S: new Date().toISOString() },
      },
    })
  );

  // 2. OpenFGA に quota_grant タプル作成
  await setUserQuotaGrant(userId, tenantId, modelId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      quotaLimits: { dailyLimit, monthlyLimit },
      setAt: new Date().toISOString(),
    }),
  };
}
```

##### 2. ユーザークォータ削除

```http
DELETE /admin/quotas/remove-user-limit
{
  "tenantId": "acme-corp",
  "userId": "user123",
  "modelId": "claude-3-sonnet"
}

Response (200 OK):
{
  "success": true,
  "removedAt": "2025-10-21T10:25:00Z"
}
```

##### 3. クォータ使用量取得

```http
GET /admin/quotas/usage?tenantId=acme-corp&userId=user123

Response (200 OK):
{
  "user": {
    "models": {
      "claude-3-sonnet": {
        "currentUsage": 8,
        "dailyLimit": 50,
        "monthlyUsage": 245,
        "monthlyLimit": 1000
      },
      "gpt-4": {
        "currentUsage": 3,
        "dailyLimit": 20,
        "monthlyUsage": 87,
        "monthlyLimit": 500
      }
    }
  },
  "tenant": {
    "models": {
      "claude-3-sonnet": {
        "currentUsage": 1500,
        "dailyLimit": 5000,
        "monthlyUsage": 45000,
        "monthlyLimit": 100000
      }
    }
  }
}
```

### Admin API CDK Stack

```typescript
// packages/cdk/lib/construct/authorization/admin-api-stack.ts
import { RestApi, LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class AdminApiStack extends Stack {
  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
    super(scope, id, props);

    // Admin API Lambda 関数群
    const grantEntitlementFn = new NodejsFunction(this, 'GrantEntitlement', {
      entry: 'lambda/admin/grantEntitlement.ts',
      environment: {
        OPENFGA_API_URL: props.openFGAEndpoint,
        OPENFGA_STORE_ID: props.openFGAStoreId,
        OPENFGA_KEY_SECRET_ARN: props.openFGAKeySecretArn,
      },
    });

    const revokeEntitlementFn = new NodejsFunction(this, 'RevokeEntitlement', {
      entry: 'lambda/admin/revokeEntitlement.ts',
    });

    const blockUserFn = new NodejsFunction(this, 'BlockUser', {
      entry: 'lambda/admin/blockCapability.ts',
    });

    const unblockUserFn = new NodejsFunction(this, 'UnblockUser', {
      entry: 'lambda/admin/unblockCapability.ts',
    });

    const listEntitlementsFn = new NodejsFunction(this, 'ListEntitlements', {
      entry: 'lambda/admin/listUserEntitlements.ts',
    });

    const setUserQuotaFn = new NodejsFunction(this, 'SetUserQuota', {
      entry: 'lambda/admin/setUserQuota.ts',
      environment: {
        DYNAMODB_USER_QUOTA_TABLE: props.userQuotaTable.tableName,
      },
    });

    const removeUserQuotaFn = new NodejsFunction(this, 'RemoveUserQuota', {
      entry: 'lambda/admin/removeUserQuota.ts',
    });

    const getQuotaUsageFn = new NodejsFunction(this, 'GetQuotaUsage', {
      entry: 'lambda/admin/getQuotaUsage.ts',
      environment: {
        DYNAMODB_USER_QUOTA_TABLE: props.userQuotaTable.tableName,
        DYNAMODB_TENANT_QUOTA_TABLE: props.tenantQuotaTable.tableName,
      },
    });

    // API Gateway ルート設定
    const adminApi = props.api.root.addResource('admin');

    // Entitlement エンドポイント
    const entitlementsResource = adminApi.addResource('entitlements');
    entitlementsResource.addResource('grant').addMethod('POST', new LambdaIntegration(grantEntitlementFn));
    entitlementsResource.addResource('revoke').addMethod('POST', new LambdaIntegration(revokeEntitlementFn));
    entitlementsResource.addResource('block').addMethod('POST', new LambdaIntegration(blockUserFn));
    entitlementsResource.addResource('unblock').addMethod('POST', new LambdaIntegration(unblockUserFn));
    entitlementsResource.addResource('list').addMethod('GET', new LambdaIntegration(listEntitlementsFn));

    // クォータエンドポイント
    const quotasResource = adminApi.addResource('quotas');
    quotasResource.addResource('set-user-limit').addMethod('POST', new LambdaIntegration(setUserQuotaFn));
    quotasResource.addResource('remove-user-limit').addMethod('DELETE', new LambdaIntegration(removeUserQuotaFn));
    quotasResource.addResource('usage').addMethod('GET', new LambdaIntegration(getQuotaUsageFn));

    // IAM 権限付与
    props.userQuotaTable.grantReadWriteData(setUserQuotaFn);
    props.userQuotaTable.grantReadWriteData(removeUserQuotaFn);
    props.userQuotaTable.grantReadData(getQuotaUsageFn);
    props.tenantQuotaTable.grantReadData(getQuotaUsageFn);
  }
}
```

---

## DynamoDB テーブル設計

認可システムで使用する DynamoDB テーブルの詳細設計です。

### 1. PlanDefinitions テーブル

プラン定義を格納します。

```typescript
// CDK 定義
const planDefinitionsTable = new Table(this, 'PlanDefinitions', {
  partitionKey: { name: 'plan_id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true,
});

// テーブル構造
interface PlanDefinition {
  plan_id: string;          // PK: 'free', 'pro', 'enterprise'
  plan_name: string;        // 'Free Plan', 'Pro Plan', 'Enterprise Plan'
  tier: string;             // 'free', 'pro', 'enterprise'
  monthly_price: number;    // 0, 29, 99
  entitlements: string[];   // ['usecase_chat', 'usecase_rag', 'model_claude_sonnet']
  quotas: {
    [modelId: string]: {
      daily: number;
      monthly: number;
    };
  };
  features: {
    max_conversations: number;
    max_documents_mb: number;
    support_level: string;
  };
  created_at: string;
  updated_at: string;
}

// サンプルデータ
{
  "plan_id": "pro",
  "plan_name": "Pro Plan",
  "tier": "pro",
  "monthly_price": 29,
  "entitlements": [
    "usecase_chat",
    "usecase_rag",
    "usecase_translation",
    "model_claude_sonnet",
    "model_gpt4"
  ],
  "quotas": {
    "claude-3-sonnet": { "daily": 100, "monthly": 2000 },
    "gpt-4": { "daily": 50, "monthly": 1000 }
  },
  "features": {
    "max_conversations": 1000,
    "max_documents_mb": 500,
    "support_level": "email"
  },
  "created_at": "2025-10-01T00:00:00Z",
  "updated_at": "2025-10-01T00:00:00Z"
}
```

### 2. UserPlanSubscriptions テーブル

ユーザーの個人プラン登録（ToC）を管理します。

```typescript
const userPlanSubscriptionsTable = new Table(this, 'UserPlanSubscriptions', {
  partitionKey: { name: 'user_id', type: AttributeType.STRING },
  sortKey: { name: 'plan_id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
});

interface UserPlanSubscription {
  user_id: string;              // PK
  plan_id: string;              // SK
  subscription_status: string;  // 'active', 'inactive', 'suspended', 'canceled'
  start_date: string;
  end_date?: string;
  payment_method?: string;      // Stripe 連携用
  stripe_subscription_id?: string;
  auto_renew: boolean;
  created_at: string;
  updated_at: string;
}
```

### 3. TenantPlanSubscriptions テーブル

テナントのプラン登録（ToB）を管理します。

```typescript
const tenantPlanSubscriptionsTable = new Table(this, 'TenantPlanSubscriptions', {
  partitionKey: { name: 'tenant_id', type: AttributeType.STRING },
  sortKey: { name: 'plan_id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
});

interface TenantPlanSubscription {
  tenant_id: string;            // PK
  plan_id: string;              // SK
  subscription_status: string;
  start_date: string;
  end_date?: string;
  max_users: number;            // プランで許可される最大ユーザー数
  current_users: number;
  billing_contact: string;
  payment_method?: string;
  stripe_subscription_id?: string;
  created_at: string;
  updated_at: string;
}
```

### 4. UserQuotaLimits テーブル

ユーザー個別のクォータ制限を管理します。

```typescript
const userQuotaLimitsTable = new Table(this, 'UserQuotaLimits', {
  partitionKey: { name: 'user_id', type: AttributeType.STRING },
  sortKey: { name: 'tenant_model', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
});

interface UserQuotaLimit {
  user_id: string;              // PK
  tenant_model: string;         // SK: 'acme-corp#claude-3-sonnet'
  daily_limit: number;
  monthly_limit: number;
  set_by_admin: string;         // 設定した管理者のユーザーID
  set_at: string;
  notes?: string;
}
```

### 5. UsageTracking テーブル

実際の使用量を追跡します。

```typescript
const usageTrackingTable = new Table(this, 'UsageTracking', {
  partitionKey: { name: 'user_id_model', type: AttributeType.STRING },
  sortKey: { name: 'date', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
  timeToLiveAttribute: 'ttl',
});

// GSI for tenant-wide usage queries
usageTrackingTable.addGlobalSecondaryIndex({
  indexName: 'TenantUsageIndex',
  partitionKey: { name: 'tenant_id_model', type: AttributeType.STRING },
  sortKey: { name: 'date', type: AttributeType.STRING },
});

interface UsageRecord {
  user_id_model: string;        // PK: 'user123#claude-3-sonnet'
  date: string;                 // SK: '2025-10-21'
  count: number;                // 使用回数
  tenant_id?: string;
  tenant_id_model?: string;     // GSI PK: 'acme-corp#claude-3-sonnet'
  last_updated: string;
  ttl: number;                  // 90日後に自動削除
}
```

### 6. TenantQuotaLimits テーブル

テナント全体のクォータプールを管理します。

```typescript
const tenantQuotaLimitsTable = new Table(this, 'TenantQuotaLimits', {
  partitionKey: { name: 'tenant_id', type: AttributeType.STRING },
  sortKey: { name: 'model_id', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
});

interface TenantQuotaLimit {
  tenant_id: string;            // PK
  model_id: string;             // SK
  daily_limit: number;
  monthly_limit: number;
  plan_id: string;              // どのプランから来たクォータか
  updated_at: string;
}
```

---

## 統合テスト

### テストシナリオ

#### 1. ToC スタンドアロンユーザー

```typescript
// __tests__/integration/toc-standalone.test.ts
describe('ToC Standalone User', () => {
  it('should allow free tier user to use chat', async () => {
    // 1. ユーザーを free プランに登録
    await grantUserPlanSubscription('alice', 'free');

    // 2. 権限チェック
    const result = await checkUsecasePermission('alice', 'chat');
    expect(result.allowed).toBe(true);
  });

  it('should deny free tier user from using RAG', async () => {
    // Free プランは RAG を含まない
    const result = await checkUsecasePermission('alice', 'rag');
    expect(result.allowed).toBe(false);
  });
});
```

#### 2. ToB テナントメンバー

```typescript
describe('ToB Tenant Member', () => {
  beforeAll(async () => {
    // テナントを enterprise プランに登録
    await grantTenantPlanSubscription('acme-corp', 'enterprise');
    // ユーザーをテナントメンバーに追加
    await grantTenantMembership('bob', 'acme-corp');
  });

  it('should allow tenant member to use enterprise features', async () => {
    const result = await checkModelPermission('bob', 'claude-opus');
    expect(result.allowed).toBe(true);
  });

  it('should deny access when admin blocks capability', async () => {
    // 管理者がユーザーをブロック
    await blockUserFromCapability('acme-corp', 'bob', 'model', 'claude-opus');

    const result = await checkModelPermission('bob', 'claude-opus');
    expect(result.allowed).toBe(false);
  });
});
```

#### 3. クォータ制限テスト

```typescript
describe('Quota Enforcement', () => {
  it('should deny access when user quota exceeded', async () => {
    const quotaContext: QuotaContext = {
      userCurrentUsage: 51,
      userQuotaLimit: 50,
      tenantCurrentUsage: 100,
      tenantQuotaLimit: 5000,
    };

    const result = await checkModelPermission('charlie', 'claude-3-sonnet', quotaContext);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_quota_exceeded');
  });

  it('should deny access when tenant quota exceeded', async () => {
    const quotaContext: QuotaContext = {
      userCurrentUsage: 5,
      userQuotaLimit: 50,
      tenantCurrentUsage: 5001,
      tenantQuotaLimit: 5000,
    };

    const result = await checkModelPermission('charlie', 'claude-3-sonnet', quotaContext);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('tenant_quota_exceeded');
  });
});
```

---

## Resources

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA Production Guide](https://openfga.dev/docs/best-practices/running-in-production)
- [ECS Fargate Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [OpenFGA GitHub](https://github.com/openfga/openfga)
- [デプロイメントガイド](../../ja/openfga-deployment.md)
- [認可スキーマ詳細](./authorization-schema.md)

## License

This construct is part of the larger GenAI application and follows the same license.
