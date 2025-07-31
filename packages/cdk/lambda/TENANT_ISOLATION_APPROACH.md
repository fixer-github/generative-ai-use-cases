# Multi-Tenant Isolation Approach - Tag-Based ABAC

## Current Implementation

The current multi-tenant implementation uses **tag-based Attribute-Based Access Control (ABAC)** that combines STS AssumeRoleWithWebIdentity with IAM policy conditions based on session tags:

### 1. Authentication & Authorization Flow
1. User authenticates with Cognito and receives a JWT token
2. JWT token includes `custom:tenant_id` claim with the user's tenant ID
3. Cognito Pre-Token Generation trigger adds `https://aws.amazon.com/tags` claim with tenant ID
4. Frontend calls the `assumeRoleForTenant` API with the JWT token
5. STS validates the token and maps the tenant ID to a `TenantID` session tag
6. IAM policies use `aws:PrincipalTag/TenantID` to restrict access to tenant-specific resources

### 2. Tenant Isolation Mechanism

**Tag-Based ABAC** (Implemented):
- Cognito Pre-Token Generation Lambda adds session tags to the JWT
- STS AssumeRoleWithWebIdentity maps these tags to the session
- IAM policies use `${aws:PrincipalTag/TenantID}` for dynamic resource access
- Resources must follow naming pattern: `<resource-prefix>-tenant-<TenantID>`

**How It Works**:
```json
// JWT claim added by Cognito
"https://aws.amazon.com/tags": {
  "principal_tags": {
    "TenantID": ["tenant-123"]
  },
  "transitive_tag_keys": ["TenantID"]
}
```

```typescript
// IAM policy with dynamic tenant access
{
  "Effect": "Allow",
  "Action": ["dynamodb:*"],
  "Resource": "arn:aws:dynamodb:*:*:table/*-tenant-${aws:PrincipalTag/TenantID}"
}
```

## Benefits of Tag-Based ABAC

1. **True IAM-Level Isolation**: AWS enforces tenant boundaries, not application code
2. **Dynamic Access Control**: Single role serves all tenants with automatic isolation
3. **Direct SDK Access**: Clients can use AWS SDKs directly with proper isolation
4. **Reduced Lambda Overhead**: No need for Lambda functions to validate tenant access
5. **Audit Trail**: CloudTrail logs show tenant context via session tags
6. **Scalability**: No need to create separate roles per tenant
7. **Compliance**: Meets security requirements for multi-tenant SaaS

## Implementation Details

### Cognito Pre-Token Generation
- Lambda trigger adds `https://aws.amazon.com/tags` claim to JWT
- Includes both `principal_tags` and `transitive_tag_keys`
- Tags are passed through to STS during AssumeRoleWithWebIdentity

### IAM Role Configuration
- Trust policy allows `sts:TagSession` action
- Resource policies use `${aws:PrincipalTag/TenantID}` for dynamic access
- Deny policy ensures TenantID tag is always present

### Resource Naming Convention
- DynamoDB tables: `<TableName>-tenant-<TenantID>`
- S3 buckets: `<BucketPrefix>-tenant-<TenantID>`
- Must match the pattern expected by IAM policies

## Security Considerations

1. **Tag Validation**: IAM denies access if TenantID tag is missing
2. **Immutable Tags**: Once set during AssumeRole, tags cannot be modified
3. **Transitive Tags**: Tags are passed to subsequent role assumptions
4. **CloudTrail**: All actions are logged with tenant context
5. **No Cross-Tenant Access**: IAM policies prevent accessing other tenants' resources

## Testing ABAC

To test the implementation:

1. **Verify JWT Claims**:
   ```bash
   # Decode the ID token and check for https://aws.amazon.com/tags claim
   jwt decode <id-token>
   ```

2. **Check Session Tags**:
   ```bash
   # After AssumeRoleWithWebIdentity, use AWS CLI
   aws sts get-caller-identity
   # The session name should include the tenant context
   ```

3. **Test Resource Access**:
   ```bash
   # Try accessing tenant-specific resources
   aws dynamodb get-item --table-name MyTable-tenant-${TENANT_ID} --key '{"id":{"S":"test"}}'
   ```

## Troubleshooting

1. **"Access Denied" Errors**:
   - Check if TenantID tag is present in the session
   - Verify resource naming matches the pattern
   - Ensure Cognito trigger is adding tags claim

2. **Missing Tags**:
   - Verify Pre-Token Generation Lambda is configured
   - Check Lambda logs for any errors
   - Ensure user has `custom:tenant_id` attribute

3. **Invalid Tag Format**:
   - Tags claim must be a JSON string, not object
   - Include both principal_tags and transitive_tag_keys

## Migration from App-Level to ABAC

If migrating from application-level isolation:

1. **Phase 1**: Deploy Cognito trigger and IAM role updates
2. **Phase 2**: Test with a subset of users
3. **Phase 3**: Update client code to use direct SDK access
4. **Phase 4**: Remove application-level tenant validation
5. **Phase 5**: Monitor CloudTrail for any access anomalies

## Hybrid Approach (Optional)

You can also use a hybrid approach where:
- IAM policies provide the security boundary (tag-based ABAC)
- Lambda functions still extract tenant ID for business logic
- This provides defense in depth with both IAM and application validation

## Best Practices

1. **Resource Naming**: Always follow the tenant naming convention
2. **Tag Validation**: Ensure all users have tenant_id attribute
3. **Monitoring**: Set up CloudWatch alarms for access patterns
4. **Testing**: Test with multiple tenants to verify isolation
5. **Documentation**: Keep tenant ID mapping documented