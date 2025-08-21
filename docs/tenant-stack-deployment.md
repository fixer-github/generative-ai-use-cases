# Tenant Stack Deployment

This document explains how to deploy tenant-specific stacks separately from the main application stack.

## Overview

The CDK application now supports deploying tenant-specific infrastructure separately. This allows you to:

- Manage tenant resources independently
- Scale tenant infrastructure as needed

## Configuration Files

The application uses separate CDK configuration files for different deployment types:

- `cdk.json` - Configuration for common stacks (main application)
- `cdk.tenant.json` - Configuration for tenant-specific stacks (gitignored)
- `cdk.tenant.example.json` - Example template for tenant configuration

This separation allows you to maintain different environment settings for common and tenant deployments.

To get started with tenant deployments:

1. Copy `cdk.tenant.example.json` to `cdk.tenant.json`
2. Update the values with your tenant-specific configuration
3. Run `npm run cdk:deploy:tenant`

## Deployment Commands

The application provides separate deployment commands for common and tenant stacks:

- `npm run cdk:deploy` - Deploys all common stacks using `cdk.json`
- `npm run cdk:deploy:tenant` - Deploys tenant-specific stacks using `cdk.tenant.json`
- `npm run cdk:destroy` - Destroys all common stacks
- `npm run cdk:destroy:tenant` - Destroys all tenant stacks

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
│       └── tenant-dynamodb-stack.ts
├── create-stacks.ts     # Main stack creation
└── create-tenant-stacks.ts  # Tenant stack creation
```

## Deploying Tenant DynamoDB Stacks

### Configuration

Configure tenant deployments by creating a `cdk.tenant.json` file:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/generative-ai-use-cases-tenant.ts",
  "context": {
    "tenantId": "tenant123",
    "tenantRegion": "us-east-1"
  }
}
```

### Deployment Commands

```bash
# Deploy all tenant stacks
npm run cdk:deploy:tenant

# Deploy a specific tenant stack
npm run cdk:deploy:tenant -- TenantDynamoDBStack-tenant123

# Destroy all tenant stacks
npm run cdk:destroy:tenant
```

### Configuration Options

- `tenantId` (required): Unique identifier for the tenant
- `tenantRegion`: AWS region for deployment (default: CDK_DEFAULT_REGION or us-east-1)

## Adding More Tenant Stacks

To add more tenant-specific stacks:

1. Create a new stack class in `packages/cdk/lib/stacks/tenant/`
2. Import and instantiate it in `packages/cdk/lib/create-tenant-stacks.ts`
3. Deploy using the same pattern as above


This policy allows tenants to access only their own tables based on the tenant ID claim in their JWT token.

## Best Practices

1. **Naming Convention**: Use consistent naming for tenant resources (e.g., include tenant ID in stack names)
2. **Table Naming**: Follow the pattern `<BaseTableName>-<TenantId>` for DynamoDB tables
3. **Isolation**: Keep tenant resources separate from common resources
4. **Documentation**: Document any tenant-specific configurations or requirements
5. **Testing**: Test tenant stack deployments in a development environment first
