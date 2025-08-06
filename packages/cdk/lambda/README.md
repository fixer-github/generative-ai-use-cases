# Multi-Tenant Implementation Guide

## Overview

This codebase implements a multi-tenant architecture with complete data isolation between tenants. Each tenant has dedicated resources following the naming pattern: `ResourceName-tenant-{tenantId}`

## Architecture

### Tag-Based Access Control (ABAC)
Tenant isolation is enforced through AWS IAM policies using session tags from the JWT token.

**Key Components:**
- **IAM Policies**: Use `${aws:PrincipalTag/TenantID}` to dynamically restrict access to tenant-specific resources
- **Session Tags**: JWT's `custom:tenant_id` claim is automatically passed as a session tag during AssumeRoleWithWebIdentity
- **Resource Naming**: Resources follow the pattern `{BaseResourceName}-tenant-{tenantId}`

**Files:**
- `repository.ts` - Repository functions that construct tenant-specific table names
- `utils/tenantUtils.ts` - Tenant ID extraction (only for resource naming, not security)
- `utils/tenantDynamoDBClient.ts` - DynamoDB client with assumed role credentials
- `utils/tenantCredentials.ts` - Handles AssumeRoleWithWebIdentity for obtaining credentials

**How it works:**
1. User's JWT contains `custom:tenant_id` claim
2. Cognito Pre-Token Generation Lambda formats tenant ID as AWS session tag
3. AssumeRoleWithWebIdentity passes session tags to the assumed role
4. IAM policies use `${aws:PrincipalTag/TenantID}` to enforce access control
5. Lambda functions extract tenant ID only to construct correct resource names
6. AWS enforces tenant isolation at the IAM level - no manual security checks needed

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

- **IAM-based isolation**: AWS enforces tenant boundaries through `${aws:PrincipalTag/TenantID}` in policies
- **No manual security checks**: The Lambda code doesn't need to verify tenant access - IAM handles it
- **JWT requirements**: Token must contain `custom:tenant_id` claim for session tags
- **CloudTrail logging**: All access is logged with tenant context for auditing
- **Fail-safe design**: Without proper tenant tag, access is denied by default

## Deployment Strategy

### Phase 1: Deploy Multi-Tenant Code (This PR)
Deploy the multi-tenant aware code with fallback support:
```bash
npm run cdk:deploy
```

### Phase 2: Create Tenant Resources (PR#18)
Create tenant-specific DynamoDB tables for each tenant:
```bash
npm run cdk:tenant:deploy -- --tenant-id <tenant-id>
```

### Fallback Behavior
The system gracefully handles missing tenant resources:
- **Default tenant** (`custom:tenant_id` = 'default' or missing): Uses standard tables
- **Custom tenant with resources**: Uses tenant-specific tables (`TableName-tenant-{id}`)
- **Custom tenant without resources**: Falls back to default tables with warning logs
- **AssumeRole failures**: Falls back to Lambda's default IAM role

## Migration Checklist

- [ ] Add `custom:tenant_id` to all users
- [ ] Deploy multi-tenant code (this PR)
- [ ] Create tenant-specific tables/buckets (PR#18)
- [ ] Configure Cognito Pre-Token Generation Lambda for session tags
- [ ] Test with multiple tenants
- [ ] Monitor CloudWatch for fallback warnings

## Environment Variables

```yaml
TABLE_NAME: ChatHistory  # Base name (without tenant suffix)
STATS_TABLE_NAME: TokenUsageStats
MULTI_TENANT_ROLE_ARN: arn:aws:iam::123456789:role/MultiTenantAccessRole
DEFAULT_TENANT_ID: default  # For backwards compatibility
```

## Troubleshooting

### Common Issues

1. **500 Internal Server Error**
   - **Cause**: Tenant-specific table doesn't exist
   - **Solution**: Check CloudWatch logs for "fallback to default table" warnings
   - **Fix**: Deploy tenant resources using PR#18 or rely on fallback behavior

2. **Access Denied Errors**
   - **Cause**: Incorrect tenant ID or missing session tags
   - **Solution**: Verify `custom:tenant_id` in JWT claims
   - **Fix**: Configure Cognito Pre-Token Generation Lambda

3. **AssumeRoleWithWebIdentity Failures**
   - **Cause**: Missing or invalid JWT token
   - **Solution**: Check Authorization header contains valid Bearer token
   - **Fix**: System will automatically fall back to default credentials

4. **Performance Issues**
   - **Cause**: Repeated credential fetching
   - **Solution**: Check credential cache hit rate in CloudWatch logs
   - **Fix**: Credential caching is automatic with 55-minute TTL

### Debug Logging
Enable debug logging to troubleshoot issues:
```javascript
console.warn(`Tenant table ${tableName} not found, falling back to default table`);
console.error('Failed to assume role for tenant access, falling back to default:', error);
```