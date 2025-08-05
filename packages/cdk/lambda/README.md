# Multi-Tenant Implementation Guide

## Overview

This codebase implements a multi-tenant architecture with complete data isolation between tenants. Each tenant has dedicated resources following the naming pattern: `ResourceName-tenant-{tenantId}`

## Architecture

### Application-Level Multi-Tenancy
Repository functions extract tenant ID from JWT and route to correct tenant-specific resources.

**Files:**
- `repository.ts` - Repository functions with tenant support
- `utils/tenantUtils.ts` - Tenant ID extraction from JWT
- `utils/tenantDynamoDBClient.ts` - DynamoDB client with tenant isolation
- `utils/tenantCredentials.ts` - Shared credentials management for tenant access

**How it works:**
1. User's JWT contains `custom:tenant_id` claim
2. Repository functions extract tenant ID from API Gateway event
3. AssumeRoleWithWebIdentity is used to get tenant-specific credentials
4. Resource names are dynamically generated: `{BaseResourceName}-tenant-{tenantId}`
5. Each tenant's data is isolated in separate resources

## Quick Start

### 1. Ensure User Has Tenant ID
```javascript
// User attributes must include:
{
  "custom:tenant_id": "company-a"
}
```

### 2. Create Tenant Resources
```bash
# DynamoDB table
aws dynamodb create-table \
  --table-name ChatHistory-tenant-company-a \
  --key-schema AttributeName=id,KeyType=HASH AttributeName=createdDate,KeyType=RANGE

# S3 bucket  
aws s3 mb s3://uploads-tenant-company-a
```

### 3. Use in Lambda
```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';
import { createChat } from './repository';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer.claims['cognito:username'];
  
  // Repository handles tenant isolation automatically
  const chat = await createChat(userId, event);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ chat })
  };
};
```

## Resource Naming

All tenant resources MUST follow this pattern:
- DynamoDB: `{TableName}-tenant-{tenantId}`
- S3: `{BucketPrefix}-tenant-{tenantId}`
- Other AWS resources: `{ResourceName}-tenant-{tenantId}`

## Security

- Each tenant's data is completely isolated
- IAM policies prevent cross-tenant access
- JWT token must contain `custom:tenant_id` claim
- CloudTrail logs all access with tenant context

## Migration Checklist

- [ ] Add `custom:tenant_id` to all users
- [ ] Create tenant-specific tables/buckets
- [ ] Update Lambda functions to pass event parameter
- [ ] Test with multiple tenants
- [ ] Monitor CloudWatch for access errors

## Environment Variables

```yaml
TABLE_NAME: ChatHistory  # Base name (without tenant suffix)
STATS_TABLE_NAME: TokenUsageStats
MULTI_TENANT_ROLE_ARN: arn:aws:iam::123456789:role/MultiTenantAccessRole
DEFAULT_TENANT_ID: default  # For backwards compatibility
```

## Troubleshooting

1. **"Access Denied" errors**: Check tenant ID in JWT and resource naming
2. **Missing credentials**: Ensure MULTI_TENANT_ROLE_ARN is set
3. **Performance issues**: Check credential cache hit rate in logs