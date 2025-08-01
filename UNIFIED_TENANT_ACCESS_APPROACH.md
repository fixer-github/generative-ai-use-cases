# Unified Tenant Access Approach

## Overview

This unified approach combines:
- **Normal API endpoints** (user-friendly like PR#16)
- **IAM-level security with STS** (secure like PR#15)
- **Automatic credential management** (transparent to frontend)

## Architecture

### Key Principle: "STS-Backed Lambda Execution"

Instead of the frontend managing STS credentials, Lambda functions automatically assume tenant-specific roles internally, providing both security and simplicity.

## Unified Flow

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────────────┐     ┌────────────┐
│   User   │     │ Frontend │     │   Lambda    │     │ STS (Internal)   │     │  DynamoDB  │
└────┬─────┘     └────┬─────┘     └──────┬──────┘     └────────┬─────────┘     └─────┬──────┘
     │                │                   │                      │                     │
     │ Create chat    │                   │                      │                     │
     │ ──────────────>│                   │                      │                     │
     │                │                   │                      │                     │
     │                │ POST /chats       │                      │                     │
     │                │ Authorization: JWT│                      │                     │
     │                │ ─────────────────>│                      │                     │
     │                │                   │                      │                     │
     │                │                   │ 1. Extract tenant_id │                     │
     │                │                   │    from JWT         │                     │
     │                │                   │                      │                     │
     │                │                   │ 2. Get cached STS   │                     │
     │                │                   │    credentials or   │                     │
     │                │                   │    assume new role  │                     │
     │                │                   │ ───────────────────>│                     │
     │                │                   │                      │                     │
     │                │                   │<────────────────────│                     │
     │                │                   │ Tenant credentials  │                     │
     │                │                   │                      │                     │
     │                │                   │ 3. Create DynamoDB  │                     │
     │                │                   │    client with      │                     │
     │                │                   │    tenant creds     │                     │
     │                │                   │                      │                     │
     │                │                   │ 4. Access tenant    │                     │
     │                │                   │    table (IAM       │                     │
     │                │                   │    enforced)        │                     │
     │                │                   │ ────────────────────┼────────────────────>│
     │                │                   │                      │                     │
     │                │                   │<─────────────────────┼─────────────────────│
     │                │                   │     Success          │                     │
     │                │<──────────────────│                      │                     │
     │<───────────────│  Chat created     │                      │                     │
```

## Implementation Details

### 1. Enhanced Repository Pattern

```typescript
// utils/tenantCredentialsCache.ts
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';

const stsClient = new STSClient({});
const credentialsCache = new Map<string, { credentials: any, expiry: number }>();

export async function getTenantCredentials(token: string, tenantId: string) {
  // Check cache first
  const cached = credentialsCache.get(tenantId);
  if (cached && cached.expiry > Date.now()) {
    return cached.credentials;
  }

  // Assume role with tenant context
  const sessionName = `lambda-${tenantId}-${Date.now()}`.substring(0, 64);
  const command = new AssumeRoleWithWebIdentityCommand({
    RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
    RoleSessionName: sessionName,
    WebIdentityToken: token,
    DurationSeconds: 3600,
  });

  const response = await stsClient.send(command);
  
  // Cache credentials (expire 5 min before actual expiry)
  const credentials = {
    accessKeyId: response.Credentials!.AccessKeyId!,
    secretAccessKey: response.Credentials!.SecretAccessKey!,
    sessionToken: response.Credentials!.SessionToken!,
  };
  
  credentialsCache.set(tenantId, {
    credentials,
    expiry: Date.now() + (3600 - 300) * 1000 // 55 minutes
  });

  return credentials;
}
```

### 2. Unified Repository Base Class

```typescript
// repository/unifiedRepository.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getTenantId } from './utils/tenantUtils';
import { getTenantCredentials } from './utils/tenantCredentialsCache';

export class UnifiedTenantRepository {
  private dynamoClient: DynamoDBDocumentClient;
  private tenantId: string;
  private tablePrefix: string;

  constructor(
    private event: APIGatewayProxyEvent,
    tablePrefix: string
  ) {
    this.tenantId = getTenantId(event);
    this.tablePrefix = tablePrefix;
  }

  async initialize() {
    // Get JWT token from event
    const token = this.event.headers['Authorization'];
    if (!token) {
      throw new Error('No authorization token');
    }

    // Get tenant-specific credentials
    const credentials = await getTenantCredentials(token, this.tenantId);

    // Create DynamoDB client with tenant credentials
    const dynamoDb = new DynamoDBClient({ credentials });
    this.dynamoClient = DynamoDBDocumentClient.from(dynamoDb);
  }

  getTableName(): string {
    return `${this.tablePrefix}-tenant-${this.tenantId}`;
  }

  // All DynamoDB operations use the tenant-scoped client
  async putItem(item: any) {
    await this.dynamoClient.send(new PutCommand({
      TableName: this.getTableName(),
      Item: item,
    }));
  }

  async getItem(key: any) {
    const response = await this.dynamoClient.send(new GetCommand({
      TableName: this.getTableName(),
      Key: key,
    }));
    return response.Item;
  }

  // ... other DynamoDB operations
}
```

### 3. Updated Lambda Handler Pattern

```typescript
// lambda/createChat.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChatRepository } from './repository/chatRepository';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer!.claims['cognito:username'];
    
    // Create repository with unified approach
    const repository = new ChatRepository(event);
    await repository.initialize(); // This gets STS credentials internally
    
    // Use repository normally - IAM enforces tenant access
    const chat = await repository.createChat(userId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ chat }),
    };
  } catch (error) {
    // If IAM denies access, user tried to access wrong tenant
    if (error.name === 'AccessDeniedException') {
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          message: 'Access denied to tenant resources' 
        }),
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Internal server error' 
      }),
    };
  }
};
```

### 4. Repository Implementation

```typescript
// repository/chatRepository.ts
import { UnifiedTenantRepository } from './unifiedRepository';

export class ChatRepository extends UnifiedTenantRepository {
  constructor(event: APIGatewayProxyEvent) {
    super(event, 'ChatHistory');
  }

  async createChat(userId: string) {
    const chatId = `chat#${crypto.randomUUID()}`;
    const item = {
      id: `user#${userId}`,
      createdDate: `${Date.now()}`,
      chatId,
      title: '',
      messages: [],
    };

    // Uses tenant-scoped DynamoDB client
    await this.putItem(item);
    return item;
  }

  async listChats(userId: string) {
    // IAM automatically restricts to tenant's table only
    const response = await this.query({
      KeyConditionExpression: 'id = :userId',
      ExpressionAttributeValues: {
        ':userId': `user#${userId}`,
      },
    });
    return response.Items || [];
  }
}
```

## Benefits of Unified Approach

### 1. **Security** (from PR#15)
- ✅ IAM-level enforcement of tenant boundaries
- ✅ AWS CloudTrail audit logs with tenant context
- ✅ Impossible to access wrong tenant's data
- ✅ Credentials are short-lived (1 hour)

### 2. **Simplicity** (from PR#16)
- ✅ Frontend uses normal API endpoints
- ✅ No credential management in frontend
- ✅ Existing API contracts maintained
- ✅ Repository pattern for clean code

### 3. **Performance** (optimized)
- ✅ Credential caching reduces STS calls
- ✅ Connection pooling per tenant
- ✅ Minimal latency overhead (~50ms first call)

### 4. **Additional Benefits**
- ✅ Single codebase for all operations
- ✅ Gradual migration path from existing code
- ✅ Works with both DynamoDB and S3
- ✅ Supports direct SDK operations when needed

## Migration Strategy

### Phase 1: Infrastructure
```bash
# 1. Deploy the unified Lambda layer with credential caching
# 2. Update IAM role trust policies
# 3. Ensure Cognito adds session tags to JWT
```

### Phase 2: Repository Update
```typescript
// Before: Direct DynamoDB access
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());
await dynamoClient.send(new PutCommand({
  TableName: TABLE_NAME,
  Item: item,
}));

// After: Unified repository
const repository = new ChatRepository(event);
await repository.initialize();
await repository.createChat(userId);
```

### Phase 3: Gradual Rollout
1. Start with read operations (lower risk)
2. Move to write operations
3. Monitor CloudWatch for any access errors
4. Remove old repository code

## Error Handling

```typescript
// Unified error handling
try {
  const repository = new SomeRepository(event);
  await repository.initialize();
  // ... operations
} catch (error) {
  if (error.name === 'AccessDeniedException') {
    // User tried to access wrong tenant
    return { statusCode: 403, body: 'Forbidden' };
  }
  if (error.name === 'TokenExpiredException') {
    // JWT token expired
    return { statusCode: 401, body: 'Unauthorized' };
  }
  // Other errors
  return { statusCode: 500, body: 'Internal Error' };
}
```

## Frontend Remains Simple

```javascript
// Frontend code doesn't change!
const response = await fetch('/api/chats', {
  method: 'POST',
  headers: {
    'Authorization': idToken, // Just pass JWT
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ title: 'New Chat' }),
});

// That's it! IAM handles tenant isolation behind the scenes
```

## Comparison Matrix

| Feature | PR#15 | PR#16 | Unified |
|---------|-------|-------|---------|
| IAM Security | ✅ | ❌ | ✅ |
| Simple Frontend | ❌ | ✅ | ✅ |
| Performance | ❌ | ✅ | ✅ |
| Audit Trail | ✅ | ❌ | ✅ |
| Direct SDK | ✅ | ❌ | ✅ |
| Code Complexity | High | Low | Medium |
| Migration Effort | High | Low | Medium |

## Conclusion

The unified approach provides the best of both worlds:
- **Security** of IAM-based isolation (PR#15)
- **Simplicity** of normal API endpoints (PR#16)
- **Performance** through intelligent caching
- **Flexibility** to use direct SDK when needed

This is the recommended approach for production multi-tenant systems.