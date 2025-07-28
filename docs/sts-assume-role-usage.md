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

### 1. Enable STS Assume Role in CDK

#### Option A: Automatic Role Creation (Recommended)

Simply enable STS in your `cdk.json` and the role will be created automatically:

```json
{
  "context": {
    "enableStsAssumeRole": true
    // No tenantRoleArn needed - role is created automatically
  }
}
```

```bash
# Deploy the common stack (includes automatic IAM role creation)
npx cdk deploy GenerativeAiUseCasesStack
```

#### Option B: Use Custom Role

If you need custom IAM policies, create your own role and specify it:

```json
{
  "context": {
    "enableStsAssumeRole": true,
    "tenantRoleArn": "arn:aws:iam::123456789012:role/CustomTenantRole"
  }
}
```

### 2. Frontend Usage

The application automatically uses STS authentication when enabled in the CDK configuration.

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

To migrate existing applications to STS authentication:

1. Update CDK configuration:

   ```json
   {
     "context": {
       "enableStsAssumeRole": true
     }
   }
   ```

2. Deploy the stack (IAM role is created automatically):

   ```bash
   npx cdk deploy GenerativeAiUseCasesStack
   ```

3. Frontend code requires no changes - the `useHttp` hook automatically detects and uses STS when enabled

4. Test thoroughly with different tenant scenarios

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
