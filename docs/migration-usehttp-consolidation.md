# useHttp Hook - STS Authentication Support

This document describes how the `useHttp` hook supports STS authentication.

## Summary

The `useHttp` hook automatically detects the authentication method based on environment configuration:

- **When STS is disabled** (default): Uses Cognito ID token authentication
- **When STS is enabled**: Uses STS temporary credentials with AWS Signature V4

## Key Features

1. **Automatic Detection**: The hook checks environment variables to determine authentication method
2. **Zero Code Changes**: Existing code using `useHttp()` automatically uses STS when enabled
3. **Backward Compatible**: Works seamlessly with existing Cognito-based authentication

## Usage

### Basic Usage (Automatic Detection)

```typescript
// The hook automatically uses the right authentication method
const http = useHttp();
const { data } = http.get('/api/endpoint');
```

### Manual Override (Advanced)

```typescript
// Force specific authentication method
const http = useHttp({
  useStsTempCredentials: true, // Force STS even if env says otherwise
  roleArn: 'arn:aws:iam::123456789012:role/TenantRole',
  autoRefreshCredentials: true,
});
```

## Migration Guide

### How STS Authentication Works

1. **Automatic Multi-tenant Role Creation**:

   The system automatically creates a multi-tenant IAM role when you deploy the stack. This role enables secure tenant isolation using STS AssumeRoleWithWebIdentity.

2. **Deploy the stack**:

   ```bash
   npx cdk deploy GenerativeAiUseCasesStack
   ```

3. **That's it!** The frontend automatically uses STS authentication for tenant-isolated resources. No code changes required.

## Environment Variables

When STS is enabled via CDK configuration, these environment variables are set:

- `VITE_APP_USE_STS_TEMP_CREDENTIALS`: 'true' when STS is enabled
- `VITE_APP_TENANT_ROLE_ARN`: The ARN of the tenant role to assume

## Technical Details

### Authentication Detection

- The hook checks `VITE_APP_USE_STS_TEMP_CREDENTIALS` environment variable
- When `true`, automatically configures STS authentication
- When `false` or unset, uses Cognito authentication

### Axios Instance Management

- **Cognito mode**: Uses a shared axios instance with pre-configured Cognito interceptor
- **STS mode**: Creates a new axios instance with AWS Signature V4 signing

### STS Integration

- STS credentials are obtained via `AssumeRoleWithWebIdentity`
- Credentials are automatically refreshed before expiration
- All API requests are signed with AWS Signature V4
