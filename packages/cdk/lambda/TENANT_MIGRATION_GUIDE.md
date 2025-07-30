# Multi-Tenant DynamoDB Migration Guide

This guide explains how to migrate Lambda functions to support tenant-specific DynamoDB tables.

## Overview

The multi-tenant architecture creates separate DynamoDB tables for each tenant following the pattern:
- `<TablePrefix>-tenant-<TenantID>`

## Migration Steps

### 1. Update Repository Pattern

Instead of directly updating all repository functions, we've created a new `TenantRepository` class that encapsulates tenant-specific logic.

#### Old Pattern (repository.ts):
```typescript
import { createChat, listChats } from './repository';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer!.claims['cognito:username'];
  const chat = await createChat(userId);
  // ...
};
```

#### New Pattern (repositoryV2.ts):
```typescript
import { createTenantRepository } from './repositoryV2';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer!.claims['cognito:username'];
  const repository = createTenantRepository(event);
  const chat = await repository.createChat(userId);
  // ...
};
```

### 2. Update Environment Variables

The CDK stack should be updated to use table prefixes instead of full table names:

```typescript
environment: {
  TABLE_NAME: 'ChatHistory',  // Base name without tenant suffix
  STATS_TABLE_NAME: 'TokenUsageStats',
  DEFAULT_TENANT_ID: 'default',  // For backwards compatibility
}
```

### 3. Handle Tenant ID Extraction

The tenant ID is extracted from the JWT token in the request:
- Primary source: `event.requestContext.authorizer.claims['custom:tenant_id']`
- Fallback: `DEFAULT_TENANT_ID` environment variable or 'default'

### 4. Table Naming Convention

Tables are named as: `<BaseTableName>-tenant-<TenantID>`

Examples:
- `ChatHistory-tenant-tenant123`
- `TokenUsageStats-tenant-tenant123`

### 5. Gradual Migration Strategy

1. **Phase 1**: Deploy new code alongside old code
   - Keep original handlers unchanged
   - Create new handlers with V2 suffix using TenantRepository
   - Test with specific tenants

2. **Phase 2**: Switch traffic
   - Update API Gateway to point to new handlers
   - Monitor for issues

3. **Phase 3**: Cleanup
   - Remove old handlers
   - Update all references

### 6. Testing

Test with different tenant scenarios:
1. User with tenant ID in JWT
2. User without tenant ID (should use default)
3. Cross-tenant access attempts (should fail)

### 7. Required IAM Permissions

The Lambda execution role needs permissions for all tenant tables:
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem",
    "dynamodb:GetItem",
    "dynamodb:Query",
    "dynamodb:DeleteItem",
    "dynamodb:BatchWriteItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:region:account:table/*-tenant-*"
  ]
}
```

### 8. Creating Tenant Tables

For each new tenant, create tables:
```bash
aws dynamodb create-table \
  --table-name ChatHistory-tenant-<TENANT_ID> \
  --attribute-definitions AttributeName=id,AttributeType=S AttributeName=createdDate,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH AttributeName=createdDate,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

## Example Migration

See `createChatV2.ts` for a complete example of a migrated handler.