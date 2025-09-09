# Phase 2 Cross-Account Multi-Tenancy Implementation Guide

## Overview

Phase 2 adds cross-account tenant isolation capabilities to the existing multi-tenancy system. Each tenant can now have their own AWS account while maintaining backward compatibility with Phase 1 same-account tenants.

## Key Features

- **Cross-Account Support**: Tenants can have dedicated AWS accounts for complete isolation
- **Backward Compatibility**: Existing Phase 1 same-account tenants continue to work unchanged  
- **Automatic Fallback**: If cross-account role is not configured, falls back to same-account behavior
- **No Identity Pool Changes**: Uses existing Cognito Identity Pool configuration

## How It Works

### Authentication Flow

1. **User Authentication**: User logs in via Cognito User Pool and gets JWT token
2. **Tenant Resolution**: System fetches tenant metadata from DynamoDB Tenants table
3. **Role Selection**: 
   - If `crossAccountRoleArn` exists → use cross-account role (Phase 2)
   - Otherwise → build same-account role ARN (Phase 1 fallback)
4. **Credential Exchange**: AssumeRoleWithWebIdentity using selected role ARN
5. **Resource Access**: Access tenant resources using assumed role credentials

### Data Model Changes

The `Tenant` interface now includes:

```typescript
export interface Tenant {
  // Existing Phase 1 fields
  tenantId: string;
  status: TenantStatus;
  region: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
  
  // New Phase 2 fields
  accountId?: string;              // Tenant's AWS account ID
  crossAccountRoleArn?: string;    // Full ARN of cross-account IAM role
}
```

## Implementation Details

### 1. TenantManager Updates

- Added `accountId` and `crossAccountRoleArn` optional fields
- Updated `registerTenant` and `updateTenant` functions to handle new fields
- Removed unused KMS encryption logic (role ARNs are not sensitive)

### 2. Cross-Account Authentication

- Modified `tenantCredentials.ts` to fetch tenant metadata from DynamoDB
- Implemented smart role selection with automatic fallback
- Maintains existing AssumeRoleWithWebIdentity mechanism

### 3. IAM Role Configuration

- Existing `TenantIAMStack` already supports cross-account deployment
- Trust relationship uses Identity Pool ID from context variables
- When deployed in tenant account with control plane Identity Pool ID, enables cross-account access

## Deployment Guide

### For Phase 1 (Same Account) - No Changes Required

Existing tenants continue to work without modification.

### For Phase 2 (Cross Account)

#### 1. Deploy IAM Role in Tenant Account

```bash
# In tenant account, deploy IAM stack with control plane's Identity Pool ID
cd packages/cdk
npx cdk deploy TenantIAMStack-<tenantId> \
  --context tenantId=<tenant-id> \
  --context environment=<env> \
  --context userPoolId=<control-plane-user-pool-id> \
  --context identityPoolId=<control-plane-identity-pool-id> \
  --context userPoolClientId=<control-plane-client-id> \
  --profile <tenant-account-profile>
```

#### 2. Register Cross-Account Tenant

```typescript
import { registerTenant } from './lambda/tenantManager';

await registerTenant({
  tenantId: 'tenant-123',
  region: 'us-east-1',
  accountId: '123456789012',  // Tenant's AWS account ID
  crossAccountRoleArn: 'arn:aws:iam::123456789012:role/TenantRole-tenant-123',
  metadata: {
    companyName: 'Example Corp'
  }
});
```

#### 3. Update Existing Tenant to Cross-Account

```typescript
import { updateTenant } from './lambda/tenantManager';

await updateTenant({
  tenantId: 'existing-tenant',
  accountId: '123456789012',
  crossAccountRoleArn: 'arn:aws:iam::123456789012:role/TenantRole-existing-tenant'
});
```

## Migration Strategy

### Zero-Downtime Migration

1. **Deploy Phase 2 Code**: The implementation is fully backward compatible
2. **Gradual Tenant Migration**: Migrate tenants one by one to cross-account
3. **Rollback Capability**: Remove `crossAccountRoleArn` to revert to Phase 1

### Migration Steps for Each Tenant

1. Deploy `TenantIAMStack` in tenant's AWS account
2. Deploy tenant resource stacks (S3, DynamoDB) in tenant account  
3. Update tenant record with `accountId` and `crossAccountRoleArn`
4. Verify tenant can access resources in their account
5. Optional: Remove Phase 1 resources from control plane account

## Security Considerations

### Trust Relationship

The IAM role in tenant account trusts the control plane's Cognito Identity Pool:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "cognito-identity.amazonaws.com" },
    "Action": ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"],
    "Condition": {
      "StringEquals": {
        "cognito-identity.amazonaws.com:aud": "us-east-1:IDENTITY-POOL-ID"
      },
      "ForAnyValue:StringLike": {
        "cognito-identity.amazonaws.com:amr": "authenticated"
      }
    }
  }]
}
```

### Isolation Benefits

- **Complete Account Separation**: Tenant resources are physically isolated
- **Independent Billing**: Each tenant account has separate billing
- **Separate Audit Logs**: CloudTrail logs are isolated per account
- **Network Isolation**: VPC and security groups are tenant-specific

## Testing

### Test Cross-Account Authentication

1. Register a test tenant with cross-account role
2. Authenticate as user in that tenant
3. Verify API calls use cross-account credentials
4. Confirm access to tenant-specific resources
5. Verify no access to other tenants' resources

### Test Backward Compatibility

1. Verify existing Phase 1 tenants continue working
2. Test fallback behavior when tenant metadata is unavailable
3. Confirm same-account role building still works

## Troubleshooting

### Common Issues

1. **"Failed to assume role"**: Check Identity Pool ID in tenant role trust policy
2. **"Tenant not found"**: Ensure tenant is registered in control plane DynamoDB
3. **"Access denied"**: Verify IAM role permissions and resource naming conventions

### Debugging Steps

1. Check CloudWatch logs for tenant credential requests
2. Verify DynamoDB Tenants table has correct cross-account role ARN
3. Test AssumeRole manually using AWS CLI
4. Validate Identity Pool ID matches between control plane and tenant account

## Benefits of Phase 2

### Security
- Complete tenant isolation at AWS account level
- Independent security boundaries
- Separate access management

### Compliance  
- Meets strict regulatory requirements for data separation
- Independent audit trails
- Clear tenant responsibility boundaries

### Operations
- Simplified tenant onboarding/offboarding
- Independent backup and disaster recovery
- Granular cost allocation

## Next Steps

1. **Monitoring**: Implement cross-account monitoring and alerting
2. **Cost Management**: Set up billing alerts per tenant account  
3. **Automation**: Create scripts for automated tenant account provisioning
4. **Documentation**: Update operational runbooks for cross-account procedures