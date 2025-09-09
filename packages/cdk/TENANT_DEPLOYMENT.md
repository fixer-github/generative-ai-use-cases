# Automated Tenant Deployment Guide

This guide explains how to deploy tenant-specific infrastructure with automatic registration to the control plane.

## Overview

The tenant deployment system now supports automatic registration with the control plane's TenantManager. When you deploy a tenant stack, it will:

1. **Automatically register** the tenant in the control plane's DynamoDB table
2. **Track deployment status** (provisioning → active → inactive)
3. **Support cross-account deployments** seamlessly
4. **Clean up registration** when the stack is deleted

## Prerequisites

1. **Main stack deployed** - The GenerativeAiUseCasesStack must be deployed first with TenantManager
2. **Control plane outputs** - Note the outputs from your main stack deployment
3. **Tenant account access** - AWS credentials/profile for the tenant account (if cross-account)

## Setup Steps

### 1. Get Control Plane Information

After deploying your main stack, note these outputs:
```bash
# Get outputs from main stack
aws cloudformation describe-stacks --stack-name YourMainStackName --query 'Stacks[0].Outputs'
```

You'll need:
- `TenantsTableName` (e.g., "Tenants-dev")
- `TenantRegistrationLambdaArn` 
- `UserPoolId`, `IdentityPoolId`, `UserPoolClientId` (from Cognito)

### 2. Configure Tenant Deployment

Copy and edit the configuration file:
```bash
cp packages/cdk/cdk.tenant.example.json packages/cdk/cdk.tenant.json
```

Edit `cdk.tenant.json`:
```json
{
  "context": {
    // Tenant parameters
    "tenantId": "my-tenant-123",
    "environment": "dev",
    "tenantRegion": "us-east-1",
    
    // Control plane parameters (from main stack outputs)
    "controlPlane": {
      "account": "111111111111",
      "region": "us-east-1",
      "tenantsTableName": "Tenants-dev",
      "registrationLambdaArn": "arn:aws:lambda:us-east-1:111111111111:function:TenantRegistration-dev",
      "userPoolId": "us-east-1_XXXXXXXXX",
      "identityPoolId": "us-east-1:xxx-xxx-xxx",
      "userPoolClientId": "xxxxxxxxxxxxxx"
    },
    
    "enableAutoDelete": false
  }
}
```

### 3. Set Up AWS Profile (for cross-account deployment)

Configure AWS profile for the tenant account:
```bash
aws configure --profile tenant-account-123
# Enter tenant account credentials
```

### 4. Deploy Tenant Stack

Deploy with automatic registration:
```bash
# Cross-account deployment
npm run cdk:tenant:deploy -- --profile tenant-account-123

# Same-account deployment
npm run cdk:tenant:deploy
```

## What Happens During Deployment

1. **Pre-deployment**: Custom Resource registers tenant with status "provisioning"
2. **Stack creation**: IAM roles, S3 buckets, DynamoDB tables are created
3. **Post-deployment**: Tenant status updated to "active"
4. **On error**: Tenant status set to "error" for debugging

## Verify Registration

Check that your tenant was registered:
```bash
# Query the Tenants table in your main account
aws dynamodb get-item \
  --table-name Tenants-dev \
  --key '{"tenantId":{"S":"my-tenant-123"}}' \
  --profile main-account-profile
```

## Deployment Status

The tenant registration includes these fields:
- `tenantId`: Your tenant identifier
- `accountId`: Target AWS account
- `region`: Target region
- `environment`: Environment (dev/staging/prod)
- `status`: provisioning | active | error | inactive
- `createdAt` / `updatedAt`: Timestamps
- `metadata`: Deployment context

## Troubleshooting

### Registration Fails
- Check control plane Lambda permissions
- Verify table name and Lambda ARN are correct
- Ensure cross-account trust is properly configured

### Stack Deployment Fails
- Check AWS credentials and permissions
- Verify CDK bootstrap in target account
- Review CloudFormation events for detailed errors

### Clean Up
```bash
# Delete tenant stack (automatically marks tenant as inactive)
npm run cdk:tenant:destroy -- --profile tenant-account-123
```

## Advanced Configuration

### Same-Account Deployment
Omit the `--profile` flag to deploy in the same account as control plane:
```bash
npm run cdk:tenant:deploy
```

### Multiple Environments
Use different environment values and update the `controlPlane.tenantsTableName` accordingly:
```json
{
  "context": {
    "environment": "prod",
    "controlPlane": {
      "tenantsTableName": "Tenants-prod",
      // ... other values
    }
  }
}
```