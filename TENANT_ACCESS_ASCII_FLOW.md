# Tenant Resource Access - ASCII Flow Diagrams

## 1. User Registration & Setup Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    User     │     │   Admin     │     │   Cognito   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                    │
       │  Signs up         │                    │
       │ ─────────────────>│                    │
       │                   │                    │
       │                   │ Create user with   │
       │                   │ tenant attribute   │
       │                   │ ──────────────────>│
       │                   │                    │
       │                   │                    │ Sets:
       │                   │                    │ custom:tenant_id = "company-a"
       │                   │                    │
       │                   │<───────────────────│
       │<──────────────────│    Success         │
       │                   │                    │
```

## 2. Authentication Flow with Token Enhancement

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│    User     │     │   Frontend  │     │   Cognito    │     │ PreToken Lambda │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘     └────────┬────────┘
       │                   │                    │                       │
       │ Login credentials │                    │                       │
       │ ─────────────────>│                    │                       │
       │                   │                    │                       │
       │                   │ Auth request       │                       │
       │                   │ ──────────────────>│                       │
       │                   │                    │                       │
       │                   │                    │ Trigger pre-token gen │
       │                   │                    │ ─────────────────────>│
       │                   │                    │                       │
       │                   │                    │                       │ Add to JWT:
       │                   │                    │                       │ - custom:tenant_id
       │                   │                    │                       │ - AWS session tags
       │                   │                    │                       │
       │                   │                    │<──────────────────────│
       │                   │                    │   Enhanced JWT        │
       │                   │                    │                       │
       │                   │ JWT Token with:    │                       │
       │                   │ - tenant_id        │                       │
       │                   │ - session tags     │                       │
       │                   │<───────────────────│                       │
       │                   │                    │                       │
```

## 3A. PR#16 - Application-Level Access (Repository Pattern)

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐     ┌────────────┐
│   User   │     │ Frontend │     │ API Gateway │     │  Lambda  │     │  DynamoDB  │
└────┬─────┘     └────┬─────┘     └──────┬──────┘     └────┬─────┘     └─────┬──────┘
     │                │                   │                  │                 │
     │ Create chat    │                   │                  │                 │
     │ ──────────────>│                   │                  │                 │
     │                │                   │                  │                 │
     │                │ POST /chats       │                  │                 │
     │                │ Authorization: JWT│                  │                 │
     │                │ ─────────────────>│                  │                 │
     │                │                   │                  │                 │
     │                │                   │ Forward request  │                 │
     │                │                   │ + JWT claims     │                 │
     │                │                   │ ────────────────>│                 │
     │                │                   │                  │                 │
     │                │                   │                  │ Extract from JWT:
     │                │                   │                  │ tenant_id = "company-a"
     │                │                   │                  │                 │
     │                │                   │                  │ Calculate table:│
     │                │                   │                  │ "ChatHistory-tenant-company-a"
     │                │                   │                  │                 │
     │                │                   │                  │ Create item in  │
     │                │                   │                  │ tenant table    │
     │                │                   │                  │ ───────────────>│
     │                │                   │                  │                 │
     │                │                   │                  │<────────────────│
     │                │                   │                  │    Success      │
     │                │                   │<─────────────────│                 │
     │                │<──────────────────│    Chat created │                 │
     │<───────────────│                   │                  │                 │
     │                │                   │                  │                 │
```

## 3B. PR#15 - IAM-Level Access (STS AssumeRole)

```
┌──────────┐     ┌──────────┐     ┌────────────┐     ┌─────────┐     ┌─────────┐     ┌────────┐
│   User   │     │ Frontend │     │   Lambda   │     │   STS   │     │   AWS   │     │   S3   │
└────┬─────┘     └────┬─────┘     └─────┬──────┘     └────┬────┘     └────┬────┘     └───┬────┘
     │                │                  │                  │                │              │
     │ Upload file    │                  │                  │                │              │
     │ ──────────────>│                  │                  │                │              │
     │                │                  │                  │                │              │
     │                │ POST             │                  │                │              │
     │                │ /assumeRole      │                  │                │              │
     │                │ + JWT token      │                  │                │              │
     │                │ ────────────────>│                  │                │              │
     │                │                  │                  │                │              │
     │                │                  │ AssumeRoleWith  │                │              │
     │                │                  │ WebIdentity(JWT)│                │              │
     │                │                  │ ────────────────>│                │              │
     │                │                  │                  │                │              │
     │                │                  │                  │ Map JWT tags:  │              │
     │                │                  │                  │ TenantID =     │              │
     │                │                  │                  │ "company-a"    │              │
     │                │                  │                  │                │              │
     │                │                  │ Temp credentials│                │              │
     │                │                  │ with tenant tag │                │              │
     │                │                  │<─────────────────│                │              │
     │                │                  │                  │                │              │
     │                │ AWS credentials   │                  │                │              │
     │                │<─────────────────│                  │                │              │
     │                │                  │                  │                │              │
     │                │ Configure AWS SDK │                  │                │              │
     │                │ with credentials  │                  │                │              │
     │                │ ─────────────────┼──────────────────┼───────────────>│              │
     │                │                  │                  │                │              │
     │                │                  │                  │                │ PutObject to  │
     │                │                  │                  │                │ bucket:       │
     │                │                  │                  │                │ uploads-tenant-company-a
     │                │                  │                  │                │ ────────────>│
     │                │                  │                  │                │              │
     │                │                  │                  │                │ IAM Policy:  │
     │                │                  │                  │                │ Allows only  │
     │                │                  │                  │                │ *-tenant-${TenantID}
     │                │                  │                  │                │              │
     │                │                  │                  │                │<─────────────│
     │                │<─────────────────┼──────────────────┼────────────────│   Success    │
     │<───────────────│ Upload complete  │                  │                │              │
     │                │                  │                  │                │              │
```

## 4. Resource Naming and Isolation

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Account Resources                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────┐     ┌─────────────────────────┐      │
│  │     Company A Resources  │     │   Company B Resources   │      │
│  ├─────────────────────────┤     ├─────────────────────────┤      │
│  │                         │     │                         │      │
│  │ DynamoDB Tables:        │     │ DynamoDB Tables:        │      │
│  │ - ChatHistory-tenant-   │     │ - ChatHistory-tenant-   │      │
│  │   company-a             │     │   company-b             │      │
│  │ - TokenStats-tenant-    │     │ - TokenStats-tenant-    │      │
│  │   company-a             │     │   company-b             │      │
│  │                         │     │                         │      │
│  │ S3 Buckets:             │     │ S3 Buckets:             │      │
│  │ - uploads-tenant-       │     │ - uploads-tenant-       │      │
│  │   company-a             │     │   company-b             │      │
│  │ - files-tenant-         │     │ - files-tenant-         │      │
│  │   company-a             │     │   company-b             │      │
│  └─────────────────────────┘     └─────────────────────────┘      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │                    Access Control                         │      │
│  ├─────────────────────────────────────────────────────────┤      │
│  │                                                           │      │
│  │  User A (tenant: company-a)    User B (tenant: company-b)│      │
│  │     │                              │                      │      │
│  │     │ ✓ Can access                 │ ✓ Can access        │      │
│  │     └──> company-a resources       └──> company-b resources     │
│  │                                                           │      │
│  │     ✗ Cannot access                ✗ Cannot access       │      │
│  │        company-b resources            company-a resources │      │
│  │                                                           │      │
│  └─────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

## 5. Decision Flow: Which Approach to Use?

```
                    ┌─────────────────┐
                    │ Need to access  │
                    │ tenant resource?│
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │ What type of    │
                    │ operation?      │
                    └────────┬────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────┴────────┐      ┌────────┴────────┐
        │ Chat/Message/   │      │ File Upload/    │
        │ Normal API      │      │ Direct AWS      │
        └───────┬────────┘      └────────┬────────┘
                │                         │
        ┌───────┴────────┐      ┌────────┴────────┐
        │ Use PR#16      │      │ Use PR#15       │
        │ App-Level      │      │ IAM-Level       │
        └───────┬────────┘      └────────┬────────┘
                │                         │
        ┌───────┴────────┐      ┌────────┴────────┐
        │ Lambda extracts│      │ Get STS creds   │
        │ tenant_id and  │      │ with tenant tag │
        │ routes to      │      │ for direct      │
        │ correct table  │      │ AWS access      │
        └────────────────┘      └─────────────────┘
```

## 6. Error Scenarios

```
Wrong Tenant Access Attempt:

User (company-a) ──> Tries to access ──> ChatHistory-tenant-company-b
        │                                            │
        │                                            │
        ▼                                            ▼
   PR#16 Result:                               PR#15 Result:
   Lambda returns                              IAM returns
   empty results                               "Access Denied"
   (filtered out)                              (hard block)
```