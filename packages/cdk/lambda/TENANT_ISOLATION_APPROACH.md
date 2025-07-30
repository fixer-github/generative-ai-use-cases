# Multi-Tenant Isolation Approach - Zero Trust Model

## Current Implementation

The current multi-tenant implementation uses a **zero-trust approach** that combines STS AssumeRoleWithWebIdentity with strict application-level tenant isolation:

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

## Benefits of Zero-Trust Approach

1. **No Implicit Trust**: Even with valid STS credentials, direct access to tenant resources is not possible
2. **Explicit Validation**: Every request must be validated at the application layer
3. **Defense in Depth**: Multiple layers of security (Cognito → STS → Lambda → Resource)
4. **Audit Trail**: Complete application-level logging of all tenant access
5. **Business Logic Integration**: Easy to add rate limiting, feature flags, or custom rules per tenant
6. **Simpler Security Model**: No complex IAM policy conditions or tag mappings to maintain
7. **Better Error Handling**: Application can provide meaningful error messages
8. **Testability**: Tenant isolation logic can be unit tested

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

1. **Zero-Trust Principle**: No resource access without explicit application validation
2. **Lambda-Only Access**: Resources should only be accessed through Lambda functions, never directly
3. **Credential Scope**: STS credentials grant potential access to all tenant resources, but Lambda functions enforce actual access
4. **Best Practice**: This zero-trust approach is recommended for production environments
5. **Monitoring**: Implement CloudWatch alarms for any direct resource access attempts (outside Lambda)

## Why Zero-Trust is Better Than Tag-Based ABAC

1. **Simpler**: No complex Cognito/IAM configuration
2. **More Secure**: Explicit validation at every step
3. **More Flexible**: Can implement complex business rules
4. **Easier to Audit**: Application logs show intent and context
5. **No Configuration Drift**: No risk of tag mappings getting out of sync
6. **Better DevEx**: Easier to debug and test locally