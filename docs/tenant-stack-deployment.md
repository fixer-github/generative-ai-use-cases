# Tenant Stack Deployment

This document explains how to deploy tenant-specific stacks separately from the main application stack.

## Overview

The CDK application now supports deploying tenant-specific infrastructure separately. This allows you to:
- Create IAM roles for individual tenants without redeploying the entire application
- Manage tenant resources independently
- Scale tenant infrastructure as needed

## Deployment Commands

The application provides separate deployment commands for common and tenant stacks:

- `npm run cdk:deploy` - Deploys all common stacks (main application)
- `npm run cdk:deploy:tenant` - Deploys tenant-specific stacks

## Directory Structure

```
packages/cdk/lib/
├── stacks/
│   ├── common/          # Common stacks (main application)
│   │   ├── agent-stack.ts
│   │   ├── cloud-front-waf-stack.ts
│   │   ├── dashboard-stack.ts
│   │   ├── generative-ai-use-cases-stack.ts
│   │   ├── guardrail-stack.ts
│   │   ├── rag-knowledge-base-stack.ts
│   │   └── video-tmp-bucket-stack.ts
│   └── tenant/          # Tenant-specific stacks
│       └── tenant-iam-role-stack.ts
├── create-stacks.ts     # Main stack creation
└── create-tenant-stacks.ts  # Tenant stack creation
```

## Deploying Tenant IAM Role Stack

### Using npm Command

To deploy all tenant stacks:

```bash
# Deploy all tenant stacks
npm run cdk:deploy:tenant -- \
  --context tenantId=tenant123 \
  --context identityProviderArn=arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXX \
  --context audience=your-client-id

# Deploy a specific tenant stack
npm run cdk:deploy:tenant -- \
  --context tenantId=tenant123 \
  --context identityProviderArn=arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXX \
  --context audience=your-client-id \
  TenantIamRoleStack-tenant123
```

Options:
- `tenantId` (required): Unique identifier for the tenant
- `identityProviderArn` (required): ARN of the identity provider (Cognito User Pool or OIDC provider)
- `audience` (required): Audience/Client ID for the identity provider
- `tenantIdClaim`: JWT claim containing tenant ID (default: "custom:tenant_id")
- `tenantRegion`: AWS region for deployment (default: CDK_DEFAULT_REGION or us-east-1)
- `roleName`: Custom role name (default: GenUTenantRole-{tenantId})

### Using CDK CLI Directly

For more control, use the CDK CLI directly:

```bash
cd packages/cdk
npx cdk deploy \
  --app "npx ts-node bin/generative-ai-use-cases-tenant.ts" \
  --context tenantId=tenant123 \
  --context identityProviderArn=arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_XXXXXXXX \
  --context audience=your-client-id \
  TenantIamRoleStack-tenant123
```

## Stack Outputs

After deployment, the stack will output:
- **RoleArn**: The ARN of the created IAM role
- **RoleName**: The name of the created IAM role

## Adding More Tenant Stacks

To add more tenant-specific stacks:

1. Create a new stack class in `packages/cdk/lib/stacks/tenant/`
2. Import and instantiate it in `packages/cdk/lib/create-tenant-stacks.ts`
3. Deploy using the same pattern as above

## Best Practices

1. **Naming Convention**: Use consistent naming for tenant resources (e.g., include tenant ID in stack names)
2. **Isolation**: Keep tenant resources separate from common resources
3. **Documentation**: Document any tenant-specific configurations or requirements
4. **Testing**: Test tenant stack deployments in a development environment first