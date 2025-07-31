# Tenant Deployment Guide

This guide explains how to deploy tenant-specific stacks using the CDK tenant deployment commands.

## Prerequisites

- AWS CDK CLI installed
- AWS credentials configured
- Node.js and npm installed

## Tenant CDK Commands

The following npm scripts are available for tenant stack management from the **repository root**:

### Deploy Tenant Stacks

```bash
# Run from repository root
npm run cdk:tenant:deploy -- --context tenantId=<tenant-id>
```

Additional context parameters:
- `--context identityProviderArn=<arn>` - Identity provider ARN
- `--context audience=<audience>` - Audience/Client ID
- `--context tenantIdClaim=<claim>` - Tenant ID claim (default: 'custom:tenant_id')
- `--context roleName=<name>` - IAM role name
- `--context tenantRegion=<region>` - Deployment region

Example:
```bash
npm run cdk:tenant:deploy -- \
  --context tenantId=acme-corp \
  --context identityProviderArn=arn:aws:iam::123456789012:oidc-provider/example.com \
  --context audience=client-123 \
  --context tenantRegion=us-west-2
```

### List Tenant Stacks

```bash
npm run cdk:tenant:list -- --context tenantId=<tenant-id>
```

### Synthesize Tenant Stacks

```bash
npm run cdk:tenant:synth -- --context tenantId=<tenant-id>
```

### Diff Tenant Stacks

```bash
npm run cdk:tenant:diff -- --context tenantId=<tenant-id>
```

### Destroy Tenant Stacks

```bash
npm run cdk:tenant:destroy -- --context tenantId=<tenant-id>
```

## Using Configuration File

Instead of passing context via command line, you can create a `cdk.tenant.json` file in the `packages/cdk` directory:

```json
// packages/cdk/cdk.tenant.json
{
  "context": {
    "tenantId": "acme-corp",
    "identityProviderArn": "arn:aws:iam::123456789012:oidc-provider/example.com",
    "audience": "client-123",
    "tenantIdClaim": "custom:tenant_id",
    "roleName": "TenantRole-acme-corp",
    "tenantRegion": "us-west-2"
  }
}
```

Then run commands without context parameters from the repository root:
```bash
npm run cdk:tenant:deploy
```

## Stack Naming Convention

Tenant stacks are named using the following pattern:
- IAM Role Stack: `TenantStack-<tenantId>`
- DynamoDB Stack: `TenantDynamoDBStack-<tenantId>`

## Deployment Order

When deploying tenant stacks, both the IAM role stack and DynamoDB stack are deployed together using the `--all` flag. If you need to deploy them separately:

1. Deploy specific stack:
```bash
npm run cdk:tenant:deploy -- --context tenantId=<tenant-id> TenantStack-<tenantId>
```

2. Deploy DynamoDB stack only:
```bash
npm run cdk:tenant:deploy -- --context tenantId=<tenant-id> TenantDynamoDBStack-<tenantId>
```

## Troubleshooting

### Missing Tenant ID Error
If you see "tenantId must be provided via context", ensure you're passing the tenant ID:
- Via command line: `--context tenantId=<value>`
- Via cdk.tenant.json file

### Stack Already Exists
If a stack already exists, use `cdk:tenant:diff` to see what changes will be made before deploying.

### Permission Issues
Ensure your AWS credentials have permissions to:
- Create IAM roles and policies
- Create DynamoDB tables
- Create CloudFormation stacks