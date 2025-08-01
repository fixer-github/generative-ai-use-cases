# Unified Approach - ASCII Flow Diagram

## Complete Unified Flow: Best of Both Worlds

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           UNIFIED MULTI-TENANT ARCHITECTURE                          │
│                                                                                      │
│  Frontend (Simple)                Lambda (Smart)                 AWS (Secure)        │
│  ─────────────────                ──────────────                 ────────────        │
│                                                                                      │
│  ┌──────────┐      Normal API     ┌─────────────────┐          ┌─────────────┐     │
│  │   User   │      Endpoints      │  Lambda Handler │          │     STS     │     │
│  │  (JWT)   │ ──────────────────> │                 │ ───────> │  (Cached)   │     │
│  └──────────┘                     │ 1. Extract      │          └──────┬──────┘     │
│                                   │    tenant_id    │                 │             │
│                                   │                 │                 │ Returns     │
│                                   │ 2. Get/Cache    │                 │ Tenant     │
│                                   │    STS creds    │ <───────────────┘ Creds      │
│                                   │                 │                               │
│                                   │ 3. Create       │          ┌─────────────┐     │
│                                   │    DynamoDB     │          │  DynamoDB   │     │
│                                   │    client       │ ───────> │   (IAM      │     │
│                                   │                 │          │  Protected) │     │
│                                   │ 4. Execute      │          └─────────────┘     │
│                                   │    operation    │                               │
│                                   └─────────────────┘                               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Step-by-Step Flow

```
Step 1: User Authentication
───────────────────────────
        ┌──────────┐
        │   User   │
        │ (Tenant: │        ┌──────────┐         ┌────────────────┐
        │ CompanyA)│ ────> │  Cognito │ ──────> │ JWT Enhanced   │
        └──────────┘        └──────────┘         │ - tenant_id    │
                                                 │ - session tags │
                                                 └────────────────┘

Step 2: API Request (Same as before!)
─────────────────────────────────────
        ┌──────────┐        ┌──────────┐
        │ Frontend │ ────> │   API    │   POST /api/chats
        │          │        │ Gateway  │   Authorization: Bearer {JWT}
        └──────────┘        └──────────┘   Body: { "title": "New Chat" }

Step 3: Lambda Magic (NEW!)
──────────────────────────
                            ┌─────────────────────────────────────┐
                            │         Lambda Execution             │
                            ├─────────────────────────────────────┤
                            │                                     │
                            │  async function handler(event) {    │
                            │    // 1. Parse JWT                 │
                            │    tenantId = extractTenantId(jwt) │
                            │                                     │
                            │    // 2. Get cached credentials    │
                            │    creds = await getSTSCreds(      │
                            │      jwt, tenantId                 │
                            │    )                               │
                            │                                     │
                            │    // 3. Create scoped client      │
                            │    dynamoDB = new DynamoDBClient({ │
                            │      credentials: creds            │
                            │    })                              │
                            │                                     │
                            │    // 4. Normal operations         │
                            │    await dynamoDB.putItem({        │
                            │      TableName: 'Chats-tenant-A'   │
                            │      Item: { ... }                 │
                            │    })                              │
                            │  }                                 │
                            └─────────────────────────────────────┘

Step 4: Credential Caching (Performance)
────────────────────────────────────────
        ┌───────────────────────────────────────────┐
        │          Credential Cache (In Lambda)      │
        ├───────────────────────────────────────────┤
        │                                           │
        │  Map<tenantId, credentials>              │
        │  ┌─────────────┬──────────────────────┐  │
        │  │ "company-a" │ { creds, expiry:55m } │  │
        │  │ "company-b" │ { creds, expiry:45m } │  │
        │  │ "company-c" │ { creds, expiry:30m } │  │
        │  └─────────────┴──────────────────────┘  │
        │                                           │
        │  Cache Hit: ~0ms latency                 │
        │  Cache Miss: ~200ms (STS call)           │
        └───────────────────────────────────────────┘

Step 5: IAM Enforcement (Automatic)
──────────────────────────────────
        ┌─────────────────────────────────────────────────┐
        │              IAM Policy in Action               │
        ├─────────────────────────────────────────────────┤
        │                                                 │
        │  User (company-a) → Lambda → DynamoDB          │
        │         │                        │              │
        │         │                        ▼              │
        │         │              ┌─────────────────────┐ │
        │         │              │ Chats-tenant-       │ │
        │         │              │ company-a     ✓     │ │
        │         │              └─────────────────────┘ │
        │         │                                       │
        │         │              ┌─────────────────────┐ │
        │         └─────────────>│ Chats-tenant-       │ │
        │                        │ company-b     ✗     │ │
        │                        └─────────────────────┘ │
        │                                                 │
        │  IAM Policy: "Resource": "*-tenant-${TenantID}"│
        └─────────────────────────────────────────────────┘
```

## Comparison: All Three Approaches

```
┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐
│                 │  PR#15 (STS)     │  PR#16 (App)     │  Unified         │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Frontend Work   │ Complex          │ Simple           │ Simple           │
│                 │ (Manage creds)   │ (Just API calls) │ (Just API calls) │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Backend Work    │ Simple           │ Complex          │ Medium           │
│                 │ (Pass through)   │ (Tenant logic)   │ (STS + cache)    │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Security        │ ████████████     │ ██████           │ ████████████     │
│                 │ IAM enforced     │ App enforced     │ IAM enforced     │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Performance     │ ████             │ ████████████     │ ██████████       │
│                 │ STS each call    │ No overhead      │ Cached STS       │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Audit Trail     │ ✓ CloudTrail     │ ✗ App logs only  │ ✓ CloudTrail     │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Direct AWS SDK  │ ✓ Yes            │ ✗ No             │ ✓ Yes (internal) │
└─────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

## Implementation Priority

```
┌─────────────────────────────────────────────┐
│          Implementation Roadmap              │
├─────────────────────────────────────────────┤
│                                             │
│  Week 1: Infrastructure                     │
│  ├─> Deploy credential caching layer        │
│  └─> Update Lambda execution role           │
│                                             │
│  Week 2: Core Services                      │
│  ├─> Implement UnifiedTenantRepository      │
│  ├─> Update ChatRepository                  │
│  └─> Test with single endpoint              │
│                                             │
│  Week 3: Migration                          │
│  ├─> Update all Lambda handlers             │
│  ├─> Add monitoring/alerts                  │
│  └─> Performance testing                    │
│                                             │
│  Week 4: Cleanup                            │
│  ├─> Remove old repository code             │
│  ├─> Update documentation                   │
│  └─> Production deployment                  │
└─────────────────────────────────────────────┘
```

## Key Advantages Visualized

```
          ┌────────────────────────────────┐
          │      UNIFIED APPROACH          │
          ├────────────────────────────────┤
          │                                │
          │  Frontend Developer Says:      │
          │  "It's just a normal API!"     │
          │          😊                    │
          │                                │
          │  Security Team Says:           │
          │  "IAM enforces everything!"    │
          │          🔒                    │
          │                                │
          │  Performance Team Says:        │
          │  "Credentials are cached!"     │
          │          ⚡                    │
          │                                │
          │  DevOps Team Says:             │
          │  "CloudTrail shows all!"       │
          │          📊                    │
          └────────────────────────────────┘
```