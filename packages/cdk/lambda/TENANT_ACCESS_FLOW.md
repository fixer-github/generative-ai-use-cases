# Multi-Tenant Access Flow - ASCII Diagrams

## 1. Complete User Journey: Registration → Authentication → Resource Access

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│    Admin    │     │   Cognito   │     │    User     │     │   Frontend   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │                   │                    │                    │
       │ Create user with  │                    │                    │
       │ tenant attribute  │                    │                    │
       │ ─────────────────>│                    │                    │
       │                   │                    │                    │
       │                   │ Sets:              │                    │
       │                   │ custom:tenant_id   │                    │
       │                   │ = "company-a"      │                    │
       │                   │                    │                    │
       │                   │<───────────────────│ Login              │
       │                   │                    │ ─────────────────> │
       │                   │                    │                    │
       │                   │ Authenticate       │                    │
       │                   │<───────────────────┼────────────────────│
       │                   │                    │                    │
       │                   │ JWT with tenant_id │                    │
       │                   │ ───────────────────┼───────────────────>│
       │                   │                    │                    │
```

## 2. Three Implementation Approaches

### Approach A: Unified (Recommended) - IAM Security + Simple API

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────┐     ┌────────────┐
│   User   │     │ Frontend │     │   Lambda    │     │   STS   │     │  DynamoDB  │
└────┬─────┘     └────┬─────┘     └──────┬──────┘     └────┬────┘     └─────┬──────┘
     │                │                   │                  │                │
     │ Create chat    │                   │                  │                │
     │ ──────────────>│                   │                  │                │
     │                │                   │                  │                │
     │                │ POST /chats       │                  │                │
     │                │ Authorization: JWT│                  │                │
     │                │ ─────────────────>│                  │                │
     │                │                   │                  │                │
     │                │                   │ 1. Extract      │                │
     │                │                   │    tenant_id    │                │
     │                │                   │    = "company-a"│                │
     │                │                   │                  │                │
     │                │                   │ 2. Check cache  │                │
     │                │                   │    for creds    │                │
     │                │                   ├──────────────────┤                │
     │                │                   │ Cache miss?     │                │
     │                │                   │ Get STS creds   │                │
     │                │                   │ ───────────────>│                │
     │                │                   │                  │                │
     │                │                   │<────────────────│                │
     │                │                   │ Tenant creds    │                │
     │                │                   │ (cached 55min)  │                │
     │                │                   │                  │                │
     │                │                   │ 3. DynamoDB     │                │
     │                │                   │    client with  │                │
     │                │                   │    tenant creds │                │
     │                │                   │                  │                │
     │                │                   │ 4. PutItem to   │                │
     │                │                   │ ChatHistory-    │                │
     │                │                   │ tenant-company-a│                │
     │                │                   │ ────────────────┼───────────────>│
     │                │                   │                  │                │
     │                │                   │                  │ IAM validates: │
     │                │                   │                  │ ✓ Allowed      │
     │                │                   │                  │                │
     │                │                   │<─────────────────┼────────────────│
     │                │<──────────────────│     Success      │                │
     │<───────────────│  Chat created     │                  │                │
```

### Approach B: Application-Level (PR#16) - Simple but Less Secure

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌────────────┐
│   User   │     │ Frontend │     │   Lambda    │     │  DynamoDB  │
└────┬─────┘     └────┬─────┘     └──────┬──────┘     └─────┬──────┘
     │                │                   │                   │
     │ Create chat    │                   │                   │
     │ ──────────────>│                   │                   │
     │                │                   │                   │
     │                │ POST /chats       │                   │
     │                │ Authorization: JWT│                   │
     │                │ ─────────────────>│                   │
     │                │                   │                   │
     │                │                   │ Extract from JWT:│
     │                │                   │ tenant_id =      │
     │                │                   │ "company-a"      │
     │                │                   │                   │
     │                │                   │ Calculate table: │
     │                │                   │ ChatHistory-     │
     │                │                   │ tenant-company-a │
     │                │                   │                   │
     │                │                   │ PutItem          │
     │                │                   │ (Lambda role)    │
     │                │                   │ ────────────────>│
     │                │                   │                   │
     │                │                   │                   │ App logic
     │                │                   │                   │ ensures
     │                │                   │                   │ correct table
     │                │                   │                   │
     │                │                   │<─────────────────│
     │                │<──────────────────│    Success       │
     │<───────────────│  Chat created     │                   │
```

### Approach C: Direct STS (PR#15) - Maximum Security, Complex Frontend

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────┐     ┌────────┐
│   User   │     │ Frontend │     │   Lambda    │     │   STS   │     │   S3   │
└────┬─────┘     └────┬─────┘     └──────┬──────┘     └────┬────┘     └───┬────┘
     │                │                   │                  │              │
     │ Upload file    │                   │                  │              │
     │ ──────────────>│                   │                  │              │
     │                │                   │                  │              │
     │                │ POST              │                  │              │
     │                │ /assumeRole       │                  │              │
     │                │ + JWT token       │                  │              │
     │                │ ─────────────────>│                  │              │
     │                │                   │                  │              │
     │                │                   │ AssumeRoleWith  │              │
     │                │                   │ WebIdentity     │              │
     │                │                   │ ───────────────>│              │
     │                │                   │                  │              │
     │                │                   │                  │ Map tags:    │
     │                │                   │                  │ TenantID =   │
     │                │                   │                  │ "company-a"  │
     │                │                   │                  │              │
     │                │                   │<─────────────────│              │
     │                │ AWS credentials   │  Temp creds      │              │
     │                │<──────────────────│  with tags       │              │
     │                │                   │                  │              │
     │                │ Configure AWS SDK │                  │              │
     │                │ with credentials  │                  │              │
     │                │ ──────────────────┼──────────────────┼─────────────>│
     │                │                   │                  │              │
     │                │                   │                  │ PutObject to │
     │                │                   │                  │ uploads-     │
     │                │                   │                  │ tenant-      │
     │                │                   │                  │ company-a    │
     │                │                   │                  │              │
     │                │                   │                  │ IAM Policy:  │
     │                │                   │                  │ Allows only  │
     │                │                   │                  │ *-tenant-    │
     │                │                   │                  │ ${TenantID}  │
     │                │                   │                  │              │
     │                │<─────────────────┼──────────────────┼──────────────│
     │<───────────────│ Upload complete  │                  │              │
```

## 3. Resource Isolation Visualization

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Account                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────┐     ┌─────────────────────────┐      │
│  │   Company A Resources   │     │   Company B Resources   │      │
│  ├─────────────────────────┤     ├─────────────────────────┤      │
│  │                         │     │                         │      │
│  │ DynamoDB:               │     │ DynamoDB:               │      │
│  │ • ChatHistory-tenant-   │     │ • ChatHistory-tenant-   │      │
│  │   company-a             │     │   company-b             │      │
│  │ • TokenStats-tenant-    │     │ • TokenStats-tenant-    │      │
│  │   company-a             │     │   company-b             │      │
│  │                         │     │                         │      │
│  │ S3:                     │     │ S3:                     │      │
│  │ • uploads-tenant-       │     │ • uploads-tenant-       │      │
│  │   company-a             │     │   company-b             │      │
│  └─────────────────────────┘     └─────────────────────────┘      │
│                                                                     │
│  User A ────────> ✓ Can access company-a resources                 │
│         ────────> ✗ Cannot access company-b resources              │
│                                                                     │
│  User B ────────> ✗ Cannot access company-a resources              │
│         ────────> ✓ Can access company-b resources                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. Credential Caching Flow (Unified Approach)

```
┌──────────────────────────────────────────────────────────┐
│                Lambda Execution Context                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Request 1 (Cold Start):                                 │
│  ┌────────┐    ┌─────────┐    ┌─────────┐    ┌────────┐│
│  │  API   │───>│ Extract │───>│   STS   │───>│ Cache  ││
│  │ Request│    │ Tenant  │    │  Call   │    │ Creds  ││
│  └────────┘    └─────────┘    └─────────┘    └────────┘│
│                                  ~200ms         55 min   │
│                                                           │
│  Request 2-N (Warm):                                     │
│  ┌────────┐    ┌─────────┐    ┌─────────┐    ┌────────┐│
│  │  API   │───>│ Extract │───>│  Cache  │───>│  Use   ││
│  │ Request│    │ Tenant  │    │  Hit    │    │ Creds  ││
│  └────────┘    └─────────┘    └─────────┘    └────────┘│
│                                   ~0ms                    │
└──────────────────────────────────────────────────────────┘
```

## 5. Security Comparison

```
┌─────────────────┬──────────────┬──────────────┬─────────────┐
│    Approach     │   Unified    │  App-Level   │ Direct STS  │
├─────────────────┼──────────────┼──────────────┼─────────────┤
│ Enforcement     │ AWS IAM      │ Lambda Code  │ AWS IAM     │
│ Frontend Work   │ None         │ None         │ Credentials │
│ Performance     │ Fast+Cache   │ Fastest      │ Slowest     │
│ Security Level  │ ████████████ │ ██████       │ ████████████│
│ Audit Trail     │ CloudTrail   │ CloudWatch   │ CloudTrail  │
│ Complexity      │ Medium       │ Low          │ High        │
└─────────────────┴──────────────┴──────────────┴─────────────┘
```

## 6. Error Handling

```
User tries to access wrong tenant:

Unified/Direct STS:                  Application-Level:
┌──────────────┐                     ┌──────────────┐
│ IAM Policy   │                     │ Lambda Logic │
│ Evaluation   │                     │ Evaluation   │
└──────┬───────┘                     └──────┬───────┘
       │                                     │
       │ Resource:                           │ if (tableName !=
       │ ChatHistory-tenant-company-b        │     expected) {
       │                                     │   filter out
       │ PrincipalTag/TenantID:            │ }
       │ company-a                           │
       │                                     │
       ▼                                     ▼
┌──────────────┐                     ┌──────────────┐
│ Access Denied│                     │ Empty Result │
│ (Hard Stop)  │                     │ (Soft Filter)│
└──────────────┘                     └──────────────┘
```