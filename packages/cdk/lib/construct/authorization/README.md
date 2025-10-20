# Authorization System

認可システム - SpiceDBベースのマルチテナント認可システム

## Overview

This directory contains the complete authorization system implementation using SpiceDB for fine-grained, relationship-based access control.

## Components

### 1. DynamoDB Tables (`plan-quota-store.ts`)

Creates three DynamoDB tables:

- **PlansTable**: Stores plan definitions (Free/Pro/Enterprise) with permissions
- **TenantPlansTable**: Maps tenants to their subscribed plans
- **UsageTable**: Tracks daily usage counters with automatic TTL cleanup

**GSIs:**
- `plan_id-index`: Find all tenants on a specific plan
- `stripe_subscription_id-index`: Look up by Stripe subscription
- `status-index`: Query active/inactive subscriptions
- `tenant_id-date-index`: Usage analytics by tenant
- `model-index`: Usage analytics by model
- `plan_id-date-index`: Usage analytics by plan

### 2. Lambda Authorizer (`../../lambda/authorizer/`)

API Gateway Lambda Authorizer that:
- Verifies Cognito JWT tokens
- Checks plan permissions (DynamoDB)
- Verifies resource access (SpiceDB)
- Checks usage quotas
- Caches authorization decisions
- Records CloudWatch metrics

**Environment Variables:**
- `COGNITO_USER_POOL_ID`: Cognito User Pool ID
- `SPICEDB_ENDPOINT`: SpiceDB gRPC endpoint
- `SPICEDB_TOKEN`: SpiceDB authentication token
- `DYNAMODB_PLAN_TABLE`: Plans table name
- `DYNAMODB_TENANT_PLAN_TABLE`: Tenant plans table name
- `DYNAMODB_USAGE_TABLE`: Usage table name
- `CACHE_ENABLED`: Enable authorization cache (default: true)
- `CACHE_TTL_SECONDS`: Cache TTL in seconds (default: 300)

### 3. Usage Tracker (`../../lambda/usage-tracker/`)

EventBridge-triggered Lambda that:
- Updates DynamoDB usage counters atomically
- Sends SNS alerts when quotas are exceeded
- Records CloudWatch metrics
- Supports idempotency via eventId

**Alert Thresholds:**
- 75%: Medium severity warning
- 90%: High severity warning
- 100%: Critical alert

### 4. Schema Migration (`../../lambda/schema-migration/`)

One-time Lambda for SpiceDB schema deployment:
- Applies authorization schema to SpiceDB
- Initializes default plans (free/pro/enterprise)
- Helper functions for tenant creation

### 5. Authorization System Construct (`authorization-system.ts`)

Main CDK construct that wires everything together:
- Creates all DynamoDB tables
- Deploys Lambda Authorizer
- Deploys Usage Tracker
- Creates SNS topic for alerts
- Sets up EventBridge rules
- Configures VPC networking for SpiceDB access

## Usage

### Basic Setup

```typescript
import { AuthorizationSystem } from './construct/authorization';

const authzSystem = new AuthorizationSystem(this, 'Authorization', {
  userPool: cognito.userPool,
  spiceDBEndpoint: 'spicedb.cluster.local:50051',
  spiceDBToken: spiceDBToken.secretValue.toString(),
  vpc: vpc,
  quotaAlertEmail: 'admin@example.com',
  enableCache: true,
  cacheTTLSeconds: 300,
  enableQuotaAlerts: true,
});
```

### Integrate with API Gateway

```typescript
import { RequestAuthorizer, IdentitySource } from 'aws-cdk-lib/aws-apigateway';

const authorizer = new RequestAuthorizer(this, 'Authorizer', {
  handler: authzSystem.authorizerFunction,
  identitySources: [IdentitySource.header('Authorization')],
  resultsCacheTtl: Duration.minutes(5),
});

// Use in API methods
api.root.addMethod('POST', new LambdaIntegration(handler), {
  authorizer,
  authorizationType: AuthorizationType.CUSTOM,
});
```

### Send Usage Events from Backend

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Grant permission to Lambda
authzSystem.grantSendUsageEvents(myLambda);

// In Lambda handler
const eventBridge = new EventBridgeClient({});

await eventBridge.send(
  new PutEventsCommand({
    Entries: [{
      Source: 'genai.usage',
      DetailType: 'UsageEvent',
      Detail: JSON.stringify({
        tenantId: context.authorizer.tenantId,
        userId: context.authorizer.userId,
        planId: context.authorizer.planId,
        resourceType: 'usecase',
        resourceId: 'chat',
        model: 'claude-3-sonnet',
        timestamp: Date.now(),
      }),
    }],
  })
);
```

## SpiceDB Schema

The authorization schema defines these entity types:

- **user**: System users
- **tenant**: Multi-tenant organizations
- **plan**: Subscription tiers (free/pro/enterprise)
- **conversation**: Chat conversations
- **document**: RAG documents
- **usecase**: GenAI usecases (chat, rag, etc.)
- **model**: AI models (claude-3-sonnet, gpt-4, etc.)
- **model_with_quota**: Models with quota enforcement via caveats
- **admin_operation**: Tenant admin operations

### Key Permissions

```spicedb
# Can user view conversation?
check conversation:123 view user:alice

# Can user execute usecase?
check usecase:chat execute user:alice

# Can user use model (with quota)?
check model_with_quota:claude-3-sonnet execute user:alice \
  --caveat-context '{"current_usage":8,"quota_limit":50}'
```

## Plan Configuration

Plans are stored in DynamoDB with this structure:

```json
{
  "plan_id": "pro",
  "plan_name": "Professional",
  "price_usd_monthly": 49.99,
  "features": {
    "max_users": 5,
    "usecases": {
      "chat": { "enabled": true },
      "rag": { "enabled": true }
    },
    "models": {
      "claude-3-haiku": {
        "enabled": true,
        "daily_quota": 100
      },
      "claude-3-sonnet": {
        "enabled": true,
        "daily_quota": 50
      }
    }
  }
}
```

## Monitoring

### CloudWatch Metrics

**Authorization/Authorizer:**
- `AuthorizationDecision`: Allow/Deny counts
- `AuthorizationLatency`: Authorization check latency

**Authorization/Usage:**
- `UsageEventProcessed`: Usage events processed
- `QuotaUtilization`: Quota utilization percentage
- `CurrentUsage`: Current usage count

### CloudWatch Logs

All Lambda functions log to CloudWatch Logs:
- `/aws/lambda/authorization-authorizer`
- `/aws/lambda/usage-tracker`
- `/aws/lambda/schema-migration`

### SNS Alerts

Quota alerts are sent via SNS when:
- 75%: Medium severity
- 90%: High severity
- 100%: Critical (quota exceeded)

## Files

```
authorization/
├── README.md                              # This file
├── index.ts                               # Exports
├── authorization-system.ts                # Main construct
├── plan-quota-store.ts                    # DynamoDB tables
├── api-gateway-integration-example.ts     # Integration example
└── ../../lambda/
    ├── authorizer/
    │   ├── authorization-authorizer.ts    # Lambda Authorizer
    │   └── package.json
    ├── usage-tracker/
    │   ├── track-usage.ts                 # Usage Tracker
    │   └── package.json
    └── schema-migration/
        ├── apply-schema.ts                # Schema migration
        └── package.json
```

## Documentation

Complete Japanese documentation is available in `docs/ja/`:

- `authorization-mvp.md`: MVP architecture guide
- `authorization-schema.md`: Schema design details
- `authorization-api-integration.md`: API integration examples
- `authorization-plan-quota.md`: Plan and quota management

## Related

- SpiceDB Schema: `../spicedb/authorization-schema.zed`
- TypeScript Types: `../../types/src/authorization.d.ts`
