# How Users Access Dedicated Tenant Resources

## Overview

This multi-tenant architecture provides two approaches for users to access their tenant-specific resources:

1. **PR#15: IAM-based with STS AssumeRoleWithWebIdentity** - Maximum security
2. **PR#16: Application-level isolation** - Better performance

## 1. User Authentication Flow

### Step 1: User Registration
```javascript
// User is created with tenant ID attribute
const user = {
  email: "user@company-a.com",
  attributes: {
    "custom:tenant_id": "company-a"  // Assigned during registration
  }
}
```

### Step 2: User Login
```javascript
// User authenticates with Cognito
const auth = await Auth.signIn(username, password);
// Receives JWT tokens with tenant information
```

### Step 3: Token Enhancement (Cognito Pre-Token Generation)
The Cognito trigger adds tenant information to JWT:
```json
{
  "sub": "user-123",
  "email": "user@company-a.com",
  "custom:tenant_id": "company-a",
  "https://aws.amazon.com/tags": {
    "principal_tags": {
      "TenantID": ["company-a"]
    },
    "transitive_tag_keys": ["TenantID"]
  }
}
```

## 2. Accessing Tenant Resources - Two Approaches

### Approach A: Direct AWS Access via STS (PR#15)

**Flow:**
1. Frontend calls `/assumeRoleForTenant` with JWT token
2. Backend validates token and calls STS AssumeRoleWithWebIdentity
3. STS returns temporary credentials with tenant-specific permissions
4. Frontend uses credentials to access AWS resources directly

**Example:**
```javascript
// 1. Get temporary credentials
const response = await fetch('/assumeRoleForTenant', {
  headers: { 'Authorization': idToken }
});
const { credentials } = await response.json();

// 2. Configure AWS SDK with tenant-specific credentials
const dynamoClient = new DynamoDBClient({
  credentials: {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken
  }
});

// 3. Access tenant-specific table directly
// IAM policy ensures access only to company-a's table
const result = await dynamoClient.send(new GetItemCommand({
  TableName: 'ChatHistory-tenant-company-a',  // Must match naming convention
  Key: { id: { S: 'user#123' } }
}));
```

**IAM Policy automatically enforces:**
```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:*"],
  "Resource": "arn:aws:dynamodb:*:*:table/*-tenant-${aws:PrincipalTag/TenantID}"
}
```

### Approach B: Application-Level API Access (PR#16)

**Flow:**
1. Frontend calls existing API endpoints with JWT token
2. Lambda extracts tenant ID from JWT claims
3. Repository functions automatically use tenant-specific tables
4. No direct AWS access from frontend

**Example:**
```javascript
// 1. Call existing API endpoint
const response = await fetch('/chats', {
  headers: { 'Authorization': idToken }
});

// 2. Lambda handler automatically routes to tenant table
// In Lambda: repository.ts
const tenantId = getTenantId(event); // Extracts "company-a" from JWT
const tableName = `ChatHistory-tenant-${tenantId}`; // ChatHistory-tenant-company-a

// 3. User only sees their tenant's data
const chats = await response.json();
// All chats are from company-a's table only
```

## 3. Resource Naming Convention

All tenant-specific resources follow this pattern:
- **DynamoDB Tables**: `{BaseTableName}-tenant-{tenantId}`
  - Example: `ChatHistory-tenant-company-a`
- **S3 Buckets**: `{BucketPrefix}-tenant-{tenantId}`
  - Example: `uploads-tenant-company-a`

## 4. Security Boundaries

### IAM-Level (PR#15)
- AWS IAM enforces tenant boundaries
- Impossible to access other tenant's resources
- CloudTrail logs show tenant context

### Application-Level (PR#16)
- Lambda functions enforce tenant boundaries
- Repository pattern ensures correct table selection
- Depends on proper JWT validation

## 5. Real-World Examples

### Creating a Chat (PR#16 Approach)
```javascript
// Frontend
const response = await fetch('/chats', {
  method: 'POST',
  headers: { 'Authorization': idToken },
  body: JSON.stringify({ title: 'New Chat' })
});

// Backend (Lambda)
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims['cognito:username'];
  const chat = await createChat(userId, event); // event contains tenant context
  // Automatically saves to ChatHistory-tenant-company-a
};
```

### Uploading a File (PR#15 Approach)
```javascript
// Frontend
// 1. Get upload URL from tenant-aware endpoint
const urlResponse = await fetch('/tenant/s3/upload-url', {
  method: 'POST',
  headers: { 'Authorization': idToken },
  body: JSON.stringify({ 
    bucket: 'uploads-tenant-company-a',
    key: 'document.pdf'
  })
});

// 2. Upload directly to S3
const { uploadUrl } = await urlResponse.json();
await fetch(uploadUrl, {
  method: 'PUT',
  body: fileContent
});
```

## 6. Tenant Provisioning

When a new tenant signs up:

1. **Create Cognito User Group** (optional)
2. **Create Tenant Resources**:
   ```bash
   # DynamoDB tables
   aws dynamodb create-table \
     --table-name ChatHistory-tenant-company-b \
     --attribute-definitions AttributeName=id,AttributeType=S \
     --key-schema AttributeName=id,KeyType=HASH
   
   # S3 buckets
   aws s3 mb s3://uploads-tenant-company-b
   ```

3. **Assign Users**: Set `custom:tenant_id` attribute during registration

## 7. Benefits of Each Approach

### PR#15 (STS/IAM):
- ✅ Maximum security - AWS enforces boundaries
- ✅ Direct SDK access - better for large files
- ✅ Detailed audit trail via CloudTrail
- ❌ STS call overhead (3-5 seconds per session)
- ❌ More complex frontend implementation

### PR#16 (Application-level):
- ✅ No changes to existing API contracts
- ✅ Better performance - no STS overhead
- ✅ Simpler frontend implementation
- ❌ Security depends on application code
- ❌ All access goes through Lambda functions

## 8. Hybrid Approach (Recommended)

Use both approaches based on use case:
- **PR#16** for normal operations (chats, messages)
- **PR#15** for sensitive operations (file uploads, bulk exports)

This provides optimal balance of security, performance, and usability.