# STS Assume Role with Web Identity Usage Guide

This guide explains how to use the STS Assume Role with Web Identity feature for enhanced security and tenant isolation in the Generative AI Use Cases application.

## Overview

The STS Assume Role with Web Identity feature allows users to exchange their Cognito tokens for temporary AWS credentials scoped to their tenant. This provides:

- **Enhanced Security**: Short-lived credentials that expire automatically
- **Tenant Isolation**: IAM policies that ensure tenants can only access their own resources
- **Fine-grained Access Control**: Permissions based on JWT claims (e.g., tenant ID)

## Architecture

```
User → Cognito → ID Token → STS AssumeRoleWithWebIdentity → Temporary Credentials → API Gateway
```

## Configuration

### 1. Multi-tenant IAM Role Setup

#### Important: Understanding the Multi-tenant Role

**The system ALWAYS creates a shared multi-tenant IAM role** that is used by ALL tenants. This is NOT a per-tenant role, but a single role that provides tenant isolation through JWT claims and IAM policy conditions.

- **One role for all tenants**: A single `MultiTenantAccessRole` is created automatically
- **Tenant isolation via JWT**: Each user's JWT contains their `tenant_id` as a principal tag
- **Dynamic permissions**: IAM policies use `${aws:PrincipalTag/TenantID}` to restrict access at runtime

#### Default Configuration (Recommended)

Simply leave `tenantRoleArn` as `null` in your `cdk.json`:

```json
{
  "context": {
    "tenantRoleArn": null // System will create the role automatically
  }
}
```

When you deploy, the CDK will:

1. Create a `MultiTenantAccessRole` with proper trust policies
2. Configure permissions that dynamically evaluate based on JWT tenant claims
3. Pass the created role ARN to the frontend automatically

#### Advanced: Using a Custom Role (Optional)

The `tenantRoleArn` parameter is ONLY needed if you want to use your own pre-existing IAM role instead of the auto-created one:

```json
{
  "context": {
    "tenantRoleArn": "arn:aws:iam::123456789012:role/YourCustomRole"
  }
}
```

**Note**: Custom roles must be configured with appropriate trust policies and permissions. Most users should use the default auto-created role.

### 2. Frontend Usage

The application automatically uses STS authentication for accessing tenant-isolated resources.

#### Using the HTTP Hook

```typescript
import useHttp from './hooks/useHttp';

function MyComponent() {
  // The hook automatically detects if STS is enabled and uses the appropriate auth method
  const http = useHttp();

  // Make API calls - authentication is handled transparently
  const { data, error } = http.get('/api/tenant-data');

  const sendData = async () => {
    await http.post('/api/data', { content: 'example' });
  };
}
```

#### Advanced: Direct STS Hook Usage

If you need direct access to STS credentials:

```typescript
import { useSts } from './hooks/useSts';

function MyComponent() {
  const { assumeRole, credentials, isLoading, error } = useSts({
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefresh: true,
  });

  // Use credentials for direct AWS SDK operations
  if (credentials) {
    const dynamoClient = new DynamoDBClient({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }
}
```

## Important: How Session Tags Work with AssumeRoleWithWebIdentity

Unlike the standard AssumeRole API, AssumeRoleWithWebIdentity **cannot** accept session tags as API parameters. Instead, session tags must be **embedded in the JWT token** by the identity provider (Cognito). This is a critical distinction for understanding how multi-tenant isolation works.

## Single Role for All Tenants

A single IAM role can securely serve all tenants because:

1. Each JWT contains the tenant ID as a principal tag
2. `${aws:PrincipalTag/TenantID}` is evaluated at runtime for each request
3. Each session is isolated based on the JWT claims

### How Simultaneous Multi-Tenant Access Works

Multiple tenants can use the same IAM role **simultaneously** without any security issues:

```
Time 10:00:00 - User from Tenant-123 accesses system
                ↓ AssumeRoleWithWebIdentity (same role ARN)
                ↓ Creates session: PrincipalTag/TenantID = "tenant-123"
                ↓ DynamoDB access: ChatHistory-tenant-123 ✓

Time 10:00:00 - User from Tenant-456 accesses at the same moment
                ↓ AssumeRoleWithWebIdentity (same role ARN)
                ↓ Creates session: PrincipalTag/TenantID = "tenant-456"
                ↓ DynamoDB access: ChatHistory-tenant-456 ✓
```

**Key Points**:

- Same IAM role ARN is used by all tenants
- Each AssumeRole creates an independent session
- `${aws:PrincipalTag/TenantID}` is dynamically evaluated per request
- Complete isolation - no cross-tenant access possible
- Scales to thousands of concurrent tenants

## Configuring Tenant IDs for Users

### Prerequisites

Each Cognito user MUST have a `custom:tenant_id` attribute set. This is what enables the multi-tenant isolation.

### Setting Tenant ID During User Registration

When creating new users, include the tenant ID:

```javascript
// Using AWS SDK
await cognito.adminCreateUser({
  UserPoolId: userPoolId,
  Username: 'user@example.com',
  UserAttributes: [
    { Name: 'email', Value: 'user@example.com' },
    { Name: 'custom:tenant_id', Value: 'tenant-123' }, // Required for multi-tenant access
  ],
});
```

### Updating Existing Users

For existing users, update their attributes:

```javascript
await cognito.adminUpdateUserAttributes({
  UserPoolId: userPoolId,
  Username: 'user@example.com',
  UserAttributes: [{ Name: 'custom:tenant_id', Value: 'tenant-456' }],
});
```

### Via AWS Console

1. Navigate to your Cognito User Pool in AWS Console
2. Go to "Users" tab
3. Select a user
4. Click "Edit user attributes"
5. Set `custom:tenant_id` to the appropriate tenant identifier (e.g., "tenant-123")

### Important Notes

- **Tenant ID Format**: Use consistent naming (e.g., "tenant-123", "org-acme", "company-xyz")
- **Resource Naming**: All resources must follow the pattern `ResourceName-{TenantID}`
- **No Tenant ID = No Access**: Users without `custom:tenant_id` cannot access tenant-isolated resources

## IAM Policy Examples

### Per-Tenant DynamoDB Table Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}",
        "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}/index/*"
      ]
    }
  ]
}
```

The `${aws:PrincipalTag/TenantID}` variable is replaced at runtime with the tenant ID from the JWT, ensuring each tenant can only access their own tables.

### Per-Tenant S3 Bucket Access

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": [
        "arn:aws:s3:::tenant-data-${aws:PrincipalTag/TenantID}",
        "arn:aws:s3:::tenant-data-${aws:PrincipalTag/TenantID}/*"
      ]
    }
  ]
}
```

## API Gateway Configuration

When STS is enabled, the API Gateway is configured to use IAM authentication:

- **Without STS**: Uses Cognito User Pool authorizer (default)
- **With STS**: Uses IAM authentication with AWS Signature V4 signing

This ensures that temporary credentials from AssumeRoleWithWebIdentity are properly validated by AWS IAM.

## Security Considerations

1. **Token Expiration**: STS credentials expire after 1 hour by default
2. **Credential Refresh**: The frontend automatically refreshes credentials before expiration
3. **Tenant Isolation**: IAM policies ensure strict tenant boundary enforcement
4. **Audit Trail**: All AssumeRole operations are logged in CloudTrail

## Troubleshooting

### Common Issues

1. **"No tenant ID found in token"**: Ensure the Cognito user has the `custom:tenant_id` attribute
2. **"Access Denied"**: Check IAM role trust policy and permissions
3. **"Invalid credentials"**: Credentials may have expired, trigger a refresh

### Debug Mode

Enable debug logging in the browser console:

```javascript
localStorage.setItem('STS_DEBUG', 'true');
```

## Migration Guide

### For New Deployments

STS authentication is now enabled by default. No additional configuration is needed.

### For Existing Applications

If you're upgrading from a version where STS was not the default:

1. **No CDK configuration change needed** - STS is now enabled by default

2. Deploy the stack (IAM role is created automatically):

   ```bash
   npx cdk deploy GenerativeAiUseCasesStack
   ```

3. Frontend code requires no changes - the `useHttp` hook automatically detects and uses STS

4. Test thoroughly with different tenant scenarios

### To Keep Legacy Authentication

If you need to maintain the legacy Cognito-only authentication (not recommended):

```json
{
  "context": {
    "enableStsAssumeRole": false
  }
}
```

## Best Practices

1. **Always use auto-refresh** for long-running sessions
2. **Implement proper error handling** for credential failures
3. **Use tenant-specific resource naming** (e.g., `TableName-TenantID`)
4. **Monitor AssumeRole usage** in CloudTrail
5. **Regularly rotate IAM role permissions** based on least privilege

## Example: Multi-Tenant Chat Application

```typescript
// Frontend component
function TenantChat() {
  // When STS is enabled, the hook automatically uses IAM authentication
  const http = useHttp();

  const sendMessage = async (message: string) => {
    // API call automatically uses tenant-scoped credentials
    await http.post('/api/messages', {
      content: message,
      // tenant_id is extracted from JWT claims in the backend
    });
  };

  const { data: messages } = http.get('/api/messages');
  // Only returns messages for the authenticated tenant
}
```

This implementation ensures complete tenant isolation at the infrastructure level, making it impossible for one tenant to access another tenant's data even if there are application-level bugs.
