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

## Migration Guide

### Phase 1: Preparation
1. **Audit existing code**: Identify all Lambda functions that interact with DynamoDB or S3
2. **Map data models**: Document all table schemas and S3 bucket structures
3. **Identify tenants**: Create a list of initial tenants and their IDs

### Phase 2: Infrastructure Setup
1. **Update IAM roles**: Add tag-based policies with `${aws:PrincipalTag/TenantID}`
2. **Configure Cognito**: Add Pre-Token Generation Lambda trigger
3. **Create tenant resources**: Provision DynamoDB tables and S3 buckets per tenant

### Phase 3: Code Migration
1. **Update repository layer**: Modify all repository functions to accept `event` parameter
2. **Update Lambda handlers**: Pass API Gateway event to repository functions
3. **Test with single tenant**: Validate functionality with one test tenant

### Phase 4: Data Migration
1. **Export existing data**: Create backups of all current data
2. **Transform data**: Add tenant prefixes to existing records if needed
3. **Import to tenant tables**: Load data into tenant-specific resources

### Phase 5: Rollout
1. **Pilot deployment**: Deploy to staging with limited tenants
2. **Monitor and validate**: Check CloudWatch logs for errors
3. **Gradual rollout**: Migrate tenants in batches
4. **Full deployment**: Complete migration for all tenants

## Implementation Next Steps

### Immediate Actions (Week 1)
- [ ] Add `custom:tenant_id` attribute to Cognito User Pool
- [ ] Deploy Pre-Token Generation Lambda
- [ ] Update IAM roles with tag-based policies
- [ ] Create first tenant's resources (tables and buckets)

### Short-term Goals (Week 2-3)
- [ ] Migrate all Lambda functions to use new repository pattern
- [ ] Implement credential caching for performance
- [ ] Add comprehensive error handling and logging
- [ ] Create automated tests for multi-tenant scenarios

### Medium-term Goals (Month 1-2)
- [ ] Build tenant provisioning automation
- [ ] Implement tenant usage monitoring and analytics
- [ ] Create admin dashboard for tenant management
- [ ] Develop data migration tools and scripts

### Long-term Goals (Quarter)
- [ ] Implement tenant-specific rate limiting
- [ ] Add cross-tenant analytics (admin only)
- [ ] Build tenant offboarding automation
- [ ] Create disaster recovery procedures per tenant

### Monitoring and Observability
- Set up CloudWatch dashboards per tenant
- Implement distributed tracing with X-Ray
- Create alerts for access violations
- Monitor credential assumption patterns

### Security Hardening
- Regular security audits of IAM policies
- Implement least privilege access reviews
- Add encryption at rest for all tenant data
- Enable AWS CloudTrail for audit logging

### Performance Optimization
- Implement connection pooling per tenant
- Add caching layers where appropriate
- Optimize DynamoDB read/write capacity
- Monitor and tune Lambda cold starts