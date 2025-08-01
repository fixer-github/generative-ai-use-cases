# Unified Multi-Tenant Approach - ASCII Flow

## Overview: Best of Both Worlds

The unified approach combines IAM-level security (like PR#15) with simple API endpoints (like PR#16). Lambda functions handle STS credentials internally, making it secure yet easy to use.

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          UNIFIED MULTI-TENANT ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. User Login & JWT Enhancement                                                 │
│  ─────────────────────────────────                                             │
│                                                                                  │
│  ┌──────────┐      ┌──────────┐      ┌───────────────┐      ┌────────────────┐ │
│  │   User   │ ───> │ Cognito  │ ───> │ Pre-Token Gen │ ───> │ Enhanced JWT   │ │
│  │          │      │          │      │    Lambda     │      │ + tenant_id    │ │
│  └──────────┘      └──────────┘      └───────────────┘      │ + session tags │ │
│                                                              └────────────────┘ │
│                                                                                  │
│  2. API Request (Simple, like normal!)                                          │
│  ────────────────────────────────────                                          │
│                                                                                  │
│  ┌──────────┐      ┌──────────┐      ┌───────────────┐                        │
│  │ Frontend │ ───> │   API    │ ───> │    Lambda     │                        │
│  │          │      │ Gateway  │      │   Handler     │                        │
│  └──────────┘      └──────────┘      └───────┬───────┘                        │
│       │                                       │                                 │
│       │ POST /api/chats                       │                                 │
│       │ Authorization: Bearer {JWT}           │                                 │
│       │ { "title": "New Chat" }              │                                 │
│       └───────────────────────────────────────┘                                 │
│                                                                                  │
│  3. Lambda Magic (Automatic STS + Caching)                                      │
│  ────────────────────────────────────────                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐       │
│  │                        Lambda Execution Flow                          │       │
│  ├─────────────────────────────────────────────────────────────────────┤       │
│  │                                                                      │       │
│  │  async handler(event) {                                             │       │
│  │    // Step 1: Extract tenant from JWT                               │       │
│  │    const tenantId = getTenantId(event); // "company-a"              │       │
│  │                                                                      │       │
│  │    // Step 2: Get/Cache STS credentials                             │       │
│  │    const dynamoClient = await getTenantDynamoDBClient(event);       │       │
│  │         │                                                            │       │
│  │         └─> Check cache for "company-a" credentials                 │       │
│  │             ├─> HIT: Use cached (0ms)                               │       │
│  │             └─> MISS: Call STS (200ms) → Cache for 55min           │       │
│  │                                                                      │       │
│  │    // Step 3: Normal DynamoDB operations (but IAM secured!)        │       │
│  │    await dynamoClient.send(new PutCommand({                         │       │
│  │      TableName: 'ChatHistory-tenant-company-a',                     │       │
│  │      Item: { ... }                                                  │       │
│  │    }));                                                             │       │
│  │  }                                                                  │       │
│  └─────────────────────────────────────────────────────────────────────┘       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Credential Caching Detail

```
┌──────────────────────────────────────────────────────────────────┐
│                    Credential Cache Management                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Lambda Container Lifecycle:                                     │
│  ──────────────────────────                                      │
│                                                                   │
│  Cold Start (First Request):                                     │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐ │
│  │ Request │───>│ No Cache│───>│  Call   │───>│ Store in Map │ │
│  │ Arrives │    │  Found  │    │   STS   │    │ tenant→creds │ │
│  └─────────┘    └─────────┘    └─────────┘    └──────────────┘ │
│                                   ~200ms         TTL: 55 min     │
│                                                                   │
│  Warm Invocations (Subsequent):                                  │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐ │
│  │ Request │───>│  Cache  │───>│  Found! │───>│ Use Existing │ │
│  │ Arrives │    │  Check  │    │  Valid  │    │ Credentials  │ │
│  └─────────┘    └─────────┘    └─────────┘    └──────────────┘ │
│                                    ~0ms                           │
│                                                                   │
│  Cache Structure:                                                │
│  ┌────────────────────────────────────────────────┐             │
│  │ Map<tenantId, { credentials, expiry }>          │             │
│  ├────────────────────────────────────────────────┤             │
│  │ "company-a" → { creds: {...}, expiry: 1234... }│             │
│  │ "company-b" → { creds: {...}, expiry: 1234... }│             │
│  │ "company-c" → { creds: {...}, expiry: 1234... }│             │
│  └────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────┘
```

## IAM Enforcement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    IAM Policy Evaluation                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Lambda (with company-a credentials) tries to access:           │
│                                                                  │
│  ┌─────────────────────────────┐    ┌─────────────────────────┐│
│  │ ChatHistory-tenant-company-a │    │ ChatHistory-tenant-     ││
│  │                              │    │ company-b               ││
│  └──────────────┬───────────────┘    └───────────┬─────────────┘│
│                 │                                 │              │
│                 ▼                                 ▼              │
│  ┌─────────────────────────────┐    ┌─────────────────────────┐│
│  │   IAM Policy Evaluation:     │    │   IAM Policy Evaluation:││
│  │                              │    │                         ││
│  │   Resource Pattern:          │    │   Resource Pattern:     ││
│  │   *-tenant-${PrincipalTag/   │    │   *-tenant-${Principal  ││
│  │              TenantID}       │    │              Tag/       ││
│  │                              │    │              TenantID}  ││
│  │   Resolves to:              │    │   Resolves to:          ││
│  │   *-tenant-company-a         │    │   *-tenant-company-a    ││
│  │                              │    │                         ││
│  │   Matches? YES ✓            │    │   Matches? NO ✗        ││
│  └─────────────────────────────┘    └─────────────────────────┘│
│                 │                                 │              │
│                 ▼                                 ▼              │
│  ┌─────────────────────────────┐    ┌─────────────────────────┐│
│  │      Access Granted          │    │      Access Denied      ││
│  └─────────────────────────────┘    └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Example

```
┌────────────────────────────────────────────────────────────┐
│                 createChatUnified.ts                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  export const handler = async (event) => {                │
│    try {                                                   │
│      const userId = event.requestContext                  │
│        .authorizer.claims['cognito:username'];            │
│                                                            │
│      // Just call the unified repository                  │
│      // All tenant isolation happens internally           │
│      const chat = await createChat(userId, event);        │
│                                                            │
│      return {                                              │
│        statusCode: 200,                                    │
│        body: JSON.stringify({ chat })                     │
│      };                                                    │
│    } catch (error) {                                       │
│      // IAM will throw AccessDeniedException              │
│      // if user tries wrong tenant                        │
│      if (error.name === 'AccessDeniedException') {        │
│        return { statusCode: 403 };                        │
│      }                                                     │
│      return { statusCode: 500 };                          │
│    }                                                       │
│  };                                                        │
└────────────────────────────────────────────────────────────┘
```

## Performance Characteristics

```
┌───────────────────────────────────────────────────────────┐
│              Performance Timeline                          │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  Cold Start:                                              │
│  0ms ──────── 50ms ──────── 200ms ──────── 250ms        │
│  │            │             │               │             │
│  │            │             │               └─ Response   │
│  │            │             └─ STS Call Complete         │
│  │            └─ JWT Parse + Tenant Extract              │
│  └─ Request Received                                      │
│                                                           │
│  Warm Start (Cached):                                    │
│  0ms ─── 10ms ─── 20ms                                   │
│  │       │        │                                       │
│  │       │        └─ Response                             │
│  │       └─ Cache Hit + DynamoDB Operation               │
│  └─ Request Received                                      │
│                                                           │
│  Cache Efficiency:                                        │
│  ┌────────────────────────────────────────┐              │
│  │ Requests  │ STS Calls │ Cache Hits    │              │
│  ├───────────┼───────────┼───────────────┤              │
│  │ 1         │ 1         │ 0%            │              │
│  │ 10        │ 1         │ 90%           │              │
│  │ 100       │ 2         │ 98%           │              │
│  │ 1000      │ 18        │ 98.2%         │              │
│  └────────────────────────────────────────┘              │
└───────────────────────────────────────────────────────────┘
```

## Key Benefits Visualized

```
┌─────────────────────────────────────────────────────────┐
│                    Unified Approach                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Frontend Developer:          Security Team:            │
│  ┌─────────────────┐         ┌─────────────────┐      │
│  │ "Just call API  │         │ "IAM enforces   │      │
│  │  normally!"     │         │  everything!"   │      │
│  │      😊         │         │      🔒         │      │
│  └─────────────────┘         └─────────────────┘      │
│                                                         │
│  DevOps Team:                Performance Team:          │
│  ┌─────────────────┐         ┌─────────────────┐      │
│  │ "CloudTrail     │         │ "Credentials    │      │
│  │  logs all!"     │         │  are cached!"   │      │
│  │      📊         │         │      ⚡         │      │
│  └─────────────────┘         └─────────────────┘      │
└─────────────────────────────────────────────────────────┘
```