# useHttp Hook Consolidation

This document describes the consolidation of `useHttp` and `useHttpWithSts` hooks into a single `useHttp` hook.

## Summary

The `useHttpWithSts` hook has been merged into `useHttp` to eliminate code duplication and simplify maintenance. The consolidated hook supports both authentication methods:
- **Default**: Cognito ID token authentication (backward compatible)
- **Optional**: STS temporary credentials with AWS Signature V4

## Key Changes

1. **Removed**: `useHttpWithSts.ts` file
2. **Updated**: `useHttp.ts` now includes all STS functionality
3. **Backward Compatible**: Existing code using `useHttp()` continues to work without changes

## Usage

### Basic Usage (Cognito Auth - No Changes Required)
```typescript
// Existing code continues to work
const http = useHttp();
const { data } = http.get('/api/endpoint');
```

### STS Authentication
```typescript
// Option 1: Manual configuration
const http = useHttp({
  useStsTempCredentials: true,
  roleArn: 'arn:aws:iam::123456789012:role/TenantRole',
  autoRefreshCredentials: true
});

// Option 2: Use environment configuration
import { getStsConfig } from '@/hooks/useHttp';
const http = useHttp(getStsConfig());
```

## Migration Guide

### For Existing Code
No migration needed. All existing code using `useHttp()` continues to work as before.

### For New STS-Enabled Features
Instead of importing a separate `useHttpWithSts`, use the consolidated `useHttp` with configuration:

```typescript
// Before (would have been):
import useHttpWithSts from '@/hooks/useHttpWithSts';
const http = useHttpWithSts({ roleArn: '...' });

// After:
import useHttp from '@/hooks/useHttp';
const http = useHttp({ 
  useStsTempCredentials: true,
  roleArn: '...' 
});
```

## Environment Variables

When STS is enabled via CDK configuration, these environment variables are set:
- `VITE_APP_USE_STS_TEMP_CREDENTIALS`: 'true' when STS is enabled
- `VITE_APP_TENANT_ROLE_ARN`: The ARN of the tenant role to assume

## Technical Details

### Shared Instance
- When no config is provided, a shared axios instance is used (backward compatibility)
- The shared instance has Cognito auth interceptor pre-configured

### New Instances
- When any config is provided, a new axios instance is created
- Interceptors are configured based on the provided config

### STS Integration
- STS hook (`useSts`) is only initialized when `useStsTempCredentials` is true
- Credentials are automatically refreshed when `autoRefreshCredentials` is true