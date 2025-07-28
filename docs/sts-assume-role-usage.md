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

Add the following to your `cdk.json`:

```json
{
  "context": {
    "enableStsAssumeRole": true,
    "tenantRoleArn": "arn:aws:iam::123456789012:role/TenantAccessRole"
  }
}
```

### 2. Create Tenant IAM Role

Deploy the tenant IAM role stack:

```bash
npx cdk deploy TenantIamRoleStack \
  --parameters IdentityProviderArn=arn:aws:cognito-identity:region:account:identitypool/pool-id \
  --parameters Audience=your-cognito-client-id
```

### 3. Frontend Usage

#### Using the STS Hook

```typescript
import { useSts } from './hooks/useSts';

function MyComponent() {
  const { assumeRole, credentials, isLoading, error } = useSts({
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefresh: true,
    refreshBuffer: 5, // refresh 5 minutes before expiration
  });

  // Assume role on component mount
  useEffect(() => {
    assumeRole();
  }, [assumeRole]);

  // Use credentials for AWS SDK operations
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

#### Using the Enhanced HTTP Hook

```typescript
import useHttpWithSts from './hooks/useHttpWithSts';

function MyComponent() {
  const http = useHttpWithSts({
    useStsTempCredentials: true,
    roleArn: import.meta.env.VITE_APP_TENANT_ROLE_ARN,
    autoRefreshCredentials: true,
  });

  // Make API calls with STS credentials
  const { data, error } = http.get('/api/tenant-data');
}
```

## IAM Policy Examples

### Per-Tenant DynamoDB Table Access

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:*"],
    "Resource": [
      "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}",
      "arn:aws:dynamodb:*:*:table/ChatHistory-${aws:PrincipalTag/TenantID}/index/*"
    ]
  }]
}
```

### Per-Tenant S3 Bucket Access

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:*"],
    "Resource": [
      "arn:aws:s3:::tenant-data-${aws:PrincipalTag/TenantID}",
      "arn:aws:s3:::tenant-data-${aws:PrincipalTag/TenantID}/*"
    ]
  }]
}
```

## API Gateway Configuration

The API Gateway supports both authentication methods:

1. **Cognito Token**: Traditional authentication using Cognito ID tokens
2. **IAM Authentication**: Using STS temporary credentials with AWS Signature V4

The custom authorizer automatically detects and validates both authentication types.

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

To migrate existing applications:

1. Deploy the tenant IAM role
2. Update CDK configuration to enable STS
3. Update frontend to use `useHttpWithSts` instead of `useHttp`
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
  const http = useHttpWithSts({
    useStsTempCredentials: true,
    roleArn: process.env.VITE_APP_TENANT_ROLE_ARN,
  });

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