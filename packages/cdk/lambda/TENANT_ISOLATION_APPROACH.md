# Multi-Tenant Isolation Approach

## Current Implementation

The current multi-tenant implementation uses a **hybrid approach** that combines STS AssumeRoleWithWebIdentity with application-level tenant isolation:

### 1. Authentication & Authorization Flow
1. User authenticates with Cognito and receives a JWT token
2. JWT token includes `custom:tenant_id` claim with the user's tenant ID
3. Frontend calls the `assumeRoleForTenant` API with the JWT token
4. STS validates the token and returns temporary AWS credentials
5. Frontend uses these credentials to directly access AWS services

### 2. Tenant Isolation Mechanism

**Application-Level Isolation** (Currently Implemented):
- Lambda functions extract tenant ID from JWT claims using `getTenantId()`
- Tenant ID is used to construct tenant-specific resource names:
  - DynamoDB tables: `<BaseTableName>-tenant-<TenantID>`
  - S3 buckets: `<BucketPrefix>-tenant-<TenantID>`
- IAM role has broad permissions to access all tenant resources (`*-tenant-*`)
- Actual isolation is enforced by the application logic

**Why Not PrincipalTag-Based ABAC?**
- `AssumeRoleWithWebIdentity` doesn't support passing custom session tags via API
- Session tags must be configured in the OIDC provider (Cognito) using the `https://aws.amazon.com/tags` claim
- This requires additional Cognito configuration that's not trivial to implement

## Benefits of Current Approach

1. **Simplicity**: No complex Cognito configuration required
2. **Flexibility**: Easy to add new tenant-specific logic in Lambda functions
3. **Compatibility**: Works with existing Cognito setup without modifications
4. **Debugging**: Easier to trace and debug tenant access patterns

## Limitations

1. **Trust Boundary**: Relies on Lambda functions to enforce tenant isolation
2. **Direct Access**: If using STS credentials directly (not through Lambda), broader permissions apply
3. **No True ABAC**: Cannot use AWS IAM policies for fine-grained tenant isolation

## Future Improvements

### Option 1: Implement True ABAC (Recommended for Production)
1. Configure Cognito to include tenant ID in the `https://aws.amazon.com/tags` claim
2. Update IAM role trust policy to map tags from JWT to session tags
3. Use `PrincipalTag/TenantID` in IAM policies for resource-level isolation
4. Remove application-level tenant ID extraction (no longer needed)

### Option 2: Enhanced Application-Level Isolation
1. Create a centralized tenant context service
2. Implement stricter validation in all Lambda functions
3. Add monitoring and alerting for cross-tenant access attempts
4. Use AWS CloudTrail for audit logging

### Option 3: Separate Roles Per Tenant
1. Create individual IAM roles for each tenant
2. Use JWT claims to determine which role to assume
3. More complex but provides strongest isolation
4. Suitable for high-security environments

## Migration Path

To migrate to true ABAC in the future:

1. **Phase 1**: Configure Cognito
   - Add Lambda trigger to include tenant ID in tags claim
   - Test with a subset of users

2. **Phase 2**: Update IAM Policies
   - Uncomment the PrincipalTag-based policies in `multi-tenant-role.ts`
   - Test thoroughly in staging environment

3. **Phase 3**: Remove Application Logic
   - Remove `getTenantId()` calls from Lambda functions
   - Let IAM policies handle tenant isolation

4. **Phase 4**: Monitoring
   - Set up CloudWatch alarms for access denied errors
   - Monitor for any cross-tenant access attempts

## Security Considerations

1. **Current State**: Secure for Lambda-mediated access, but direct SDK usage has broader permissions
2. **Recommendation**: Use this approach for internal tools or trusted environments
3. **For Production**: Implement true ABAC or use separate roles per tenant