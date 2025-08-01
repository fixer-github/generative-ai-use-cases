# Tenant Resource Access Flow Diagram

## Complete Flow: User Registration to Resource Access

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Cognito
    participant PreTokenLambda
    participant API Gateway
    participant Lambda
    participant STS
    participant DynamoDB
    participant S3

    %% Registration Phase
    Note over User,Cognito: Registration Phase
    User->>Frontend: Sign up with company email
    Frontend->>Cognito: Create user with custom:tenant_id = "company-a"
    Cognito-->>User: Registration confirmed

    %% Authentication Phase
    Note over User,PreTokenLambda: Authentication Phase
    User->>Frontend: Login with credentials
    Frontend->>Cognito: Authenticate user
    Cognito->>PreTokenLambda: Trigger Pre-Token Generation
    PreTokenLambda->>PreTokenLambda: Add tenant tags to JWT
    PreTokenLambda-->>Cognito: Enhanced JWT token
    Cognito-->>Frontend: Return ID Token with tenant info
    
    %% Resource Access - PR#16 Approach (Application-Level)
    Note over Frontend,DynamoDB: PR#16: Application-Level Access
    Frontend->>API Gateway: GET /chats (with JWT)
    API Gateway->>Lambda: Forward request with JWT
    Lambda->>Lambda: Extract tenant_id from JWT
    Lambda->>Lambda: Calculate table name: ChatHistory-tenant-company-a
    Lambda->>DynamoDB: Query tenant-specific table
    DynamoDB-->>Lambda: Return company-a's data only
    Lambda-->>Frontend: Return filtered results

    %% Resource Access - PR#15 Approach (IAM-Level)
    Note over Frontend,S3: PR#15: Direct AWS Access via STS
    Frontend->>API Gateway: POST /assumeRoleForTenant (with JWT)
    API Gateway->>Lambda: Forward request
    Lambda->>STS: AssumeRoleWithWebIdentity(JWT)
    STS->>STS: Map JWT tags to session tags
    STS-->>Lambda: Temporary credentials with TenantID tag
    Lambda-->>Frontend: Return scoped credentials
    Frontend->>S3: Direct upload to uploads-tenant-company-a
    S3->>S3: IAM validates ${aws:PrincipalTag/TenantID}
    S3-->>Frontend: Success (or Access Denied if wrong tenant)
```

## Simplified View: Two Access Patterns

### Pattern 1: Application-Managed (PR#16)
```
User → API → Lambda → [Tenant Logic] → DynamoDB/S3
                            ↓
                  Selects correct tenant table
```

### Pattern 2: IAM-Managed (PR#15)
```
User → Get Credentials → Direct AWS Access
           ↓                      ↓
      STS with Tags        IAM enforces tenant
```

## Key Components

### 1. JWT Token Structure
```json
{
  "sub": "user-uuid",
  "email": "john@company-a.com",
  "custom:tenant_id": "company-a",
  "https://aws.amazon.com/tags": {
    "principal_tags": {
      "TenantID": ["company-a"]
    }
  }
}
```

### 2. Resource Naming
```
Base Resource: ChatHistory
Tenant Resource: ChatHistory-tenant-company-a

Base Bucket: uploads
Tenant Bucket: uploads-tenant-company-a
```

### 3. Access Control

**Application Level (PR#16):**
```typescript
// In every Lambda function
const tenantId = getTenantId(event);
const tableName = `${baseTable}-tenant-${tenantId}`;
// Only accesses tenant-specific table
```

**IAM Level (PR#15):**
```json
{
  "Resource": "arn:aws:s3:::*-tenant-${aws:PrincipalTag/TenantID}/*"
  // Automatically restricts to tenant's bucket
}
```

## Security Comparison

| Aspect | PR#15 (IAM) | PR#16 (App) |
|--------|--------------|-------------|
| Enforcement | AWS IAM | Lambda Code |
| Performance | Slower (STS) | Faster |
| Audit Trail | CloudTrail | CloudWatch |
| Direct Access | Yes | No |
| Code Complexity | Higher | Lower |
| Security Level | Maximum | Good |

## When to Use Each

**Use PR#15 (IAM/STS) for:**
- File uploads/downloads
- Bulk operations
- Third-party integrations
- Maximum security requirements

**Use PR#16 (Application) for:**
- Real-time chat operations
- Frequent API calls
- Existing API compatibility
- Better performance needs