# Assistant RAG/OpenSearch Integration - Deployment Guide

## Overview

This guide covers deploying the fixes for assistant system prompts and RAG/OpenSearch integration in a multi-tenant environment.

## Prerequisites

- AWS CLI configured with appropriate credentials
- AWS profile named `genu` (or adjust commands accordingly)
- Node.js and npm installed
- Existing tenant OpenSearch stacks deployed
- Access to tenants DynamoDB table

## Deployment Steps

### 1. Pre-Deployment: Migrate Existing Tenants

**IMPORTANT**: Run this migration BEFORE deploying the CDK changes to avoid runtime errors.

```bash
# Navigate to CDK directory
cd packages/cdk

# Run migration script with your environment
AWS_PROFILE=genu AWS_REGION=us-east-1 npx ts-node scripts/migrate-tenant-opensearch.ts <environment>

# Example for dev environment:
AWS_PROFILE=genu AWS_REGION=us-east-1 npx ts-node scripts/migrate-tenant-opensearch.ts dev

# Example for prod environment:
AWS_PROFILE=genu AWS_REGION=us-east-1 npx ts-node scripts/migrate-tenant-opensearch.ts prod
```

**What this does:**
- Scans CloudFormation for all tenant OpenSearch stacks in your environment
- Extracts OpenSearch endpoints and ARNs from stack outputs
- Updates tenant DynamoDB records with OpenSearch metadata
- Reports success/failure for each tenant

**Expected output:**
```
================================================================================
Tenant OpenSearch Endpoint Migration
================================================================================
Environment: dev
Region: us-east-1
AWS Profile: genu
Tenants Table: Tenants-dev

Searching for tenant OpenSearch stacks in environment: dev...
Found stack: dev-tenant-fixer-opensearch
  ✓ Tenant: fixer, Endpoint: vpc-dev-tenant-fixer-opensearch-xxx.us-east-1.es.amazonaws.com
Found stack: dev-tenant-demo-opensearch
  ✓ Tenant: demo, Endpoint: vpc-dev-tenant-demo-opensearch-yyy.us-east-1.es.amazonaws.com

Found 2 tenant OpenSearch stacks

Scanning tenants table: Tenants-dev...
Found 2 tenant records

================================================================================
Updating Tenant Records
================================================================================

Updating tenant fixer...
  ✓ Updated successfully

Updating tenant demo...
  ✓ Updated successfully

================================================================================
Migration Summary
================================================================================
Total stacks found: 2
Tenants updated: 2
Tenants skipped: 0

✅ Migration completed successfully!
```

### 2. Verify Migration

Check that tenant records have OpenSearch metadata:

```bash
AWS_PROFILE=genu aws dynamodb get-item \
  --table-name Tenants-dev \
  --key '{"tenantId":{"S":"fixer"}}' \
  --region us-east-1
```

Expected response should include:
```json
{
  "Item": {
    "tenantId": {"S": "fixer"},
    "openSearchEndpoint": {"S": "vpc-dev-tenant-fixer-opensearch-xxx.us-east-1.es.amazonaws.com"},
    "openSearchDomainArn": {"S": "arn:aws:es:us-east-1:123456789012:domain/dev-tenant-fixer-opensearch"},
    "openSearchIndexName": {"S": "assistant-docs"},
    ...
  }
}
```

### 3. Deploy CDK Changes

Deploy the updated infrastructure:

```bash
# Navigate to project root
cd /path/to/recreate-custom-bot

# Install dependencies (if needed)
npm install

# Deploy with genu profile
AWS_PROFILE=genu npm run cdk deploy -- --all

# Or deploy specific stacks
AWS_PROFILE=genu npm run cdk deploy -- YourAssistantApiStack
AWS_PROFILE=genu npm run cdk deploy -- YourTenantOpenSearchStack
```

**Key changes deployed:**
- Lambda environment variables (`TENANTS_TABLE_NAME`)
- IAM permissions for OpenSearch and DynamoDB
- Tenant-OpenSearch mapper Lambda and custom resource
- Updated Lambda code with validation and logging

### 4. Post-Deployment Verification

#### A. Check Lambda Configuration

Verify Lambda functions have the correct environment variables:

```bash
AWS_PROFILE=genu aws lambda get-function-configuration \
  --function-name <your-stack-name>-AssistantMessageHandler \
  --region us-east-1 \
  --query 'Environment.Variables'
```

Should include:
```json
{
  "TENANTS_TABLE_NAME": "Tenants-dev",
  "ASSISTANT_TABLE_NAME": "Assistant-dev",
  "OPENSEARCH_INDEX": "assistant-docs",
  ...
}
```

#### B. Test System Prompt Application

1. Create a test assistant with a system prompt:
```bash
curl -X POST https://your-api.execute-api.us-east-1.amazonaws.com/prod/assistant \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Assistant",
    "instruction": "You are a helpful AI assistant that always responds in haiku format.",
    "modelId": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    "ragEnabled": false
  }'
```

2. Send a test message:
```bash
curl -X POST https://your-api.execute-api.us-east-1.amazonaws.com/prod/assistant/<assistant-id>/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello, how are you?"
  }'
```

3. Check CloudWatch Logs for system prompt logging:
```bash
AWS_PROFILE=genu aws logs tail /aws/lambda/<your-stack>-AssistantMessageHandler --follow
```

Expected log entries:
```
Using assistant <id> with system prompt (XX chars)
Using system prompt without RAG context
```

#### C. Test RAG/File Upload

1. Upload a test file:
```bash
# Get upload URL
curl -X POST https://your-api.execute-api.us-east-1.amazonaws.com/prod/assistant/upload-url \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test.txt",
    "fileSize": 1024,
    "contentType": "text/plain"
  }'

# Upload file to returned URL
curl -X PUT "<presigned-url>" \
  --upload-file test.txt \
  -H "Content-Type: text/plain"
```

2. Create RAG-enabled assistant with the file:
```bash
curl -X POST https://your-api.execute-api.us-east-1.amazonaws.com/prod/assistant \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "RAG Test Assistant",
    "instruction": "Answer questions based on the provided documents.",
    "modelId": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    "ragEnabled": true,
    "knowledgeSources": [{
      "id": "test-doc",
      "sourceType": "file",
      "storageKey": "<storage-key-from-upload>"
    }]
  }'
```

3. Check CloudWatch for OpenSearch indexing:
```bash
AWS_PROFILE=genu aws logs tail /aws/lambda/<your-stack>-AssistantHandler --follow
```

Expected log entries:
```
Retrieving OpenSearch endpoint for tenant <tenant-id> from table Tenants-dev
Successfully retrieved OpenSearch endpoint for tenant <tenant-id>: vpc-...
Successfully indexed X documents for assistant <id>
```

### 5. Monitor for Issues

#### Common Issues and Solutions

**Issue 1: "TENANTS_TABLE_NAME environment variable is required"**
- **Cause**: Lambda doesn't have the environment variable
- **Solution**: Redeploy CDK stack, verify configuration in AWS Console

**Issue 2: "Tenant <id> not found in tenants table"**
- **Cause**: Migration script didn't run or tenant not in table
- **Solution**: Run migration script again, verify tenant exists in DynamoDB

**Issue 3: "OpenSearch endpoint not configured for tenant <id>"**
- **Cause**: Migration didn't populate endpoint field
- **Solution**: Manually update tenant record or re-run migration

**Issue 4: "Cannot find type definition file for 'node'"**
- **Cause**: TypeScript configuration issue (pre-existing)
- **Solution**: These are linting warnings, not blocking errors

### 6. Rollback Plan

If issues occur after deployment:

```bash
# Rollback CDK changes
AWS_PROFILE=genu npm run cdk deploy -- --rollback

# Or manually revert Lambda environment variables in AWS Console
```

The tenant DynamoDB records are safe to keep - they won't cause issues even if code is rolled back.

## Architecture Changes Summary

### Before
```
Assistant Message Request
  ↓
Lambda (no tenant lookup)
  ↓
Failed - No OpenSearch endpoint
```

### After
```
Assistant Message Request
  ↓
Lambda (TENANTS_TABLE_NAME env var)
  ↓
Read tenant record from DynamoDB
  ↓
Get OpenSearch endpoint
  ↓
Create tenant-specific vector store
  ↓
Query documents / Index files
  ↓
Enhance system prompt with RAG context
  ↓
Send to Bedrock with system prompt
```

## Support

If you encounter issues:

1. Check CloudWatch Logs for the specific Lambda function
2. Verify tenant DynamoDB records have OpenSearch metadata
3. Confirm OpenSearch domain is accessible from Lambda VPC
4. Review IAM permissions for Lambda execution role

## Next Steps

After successful deployment:

1. **Enable for all tenants**: Repeat deployment for each environment (dev, staging, prod)
2. **Monitor performance**: Track OpenSearch query latency and vector store caching
3. **Update documentation**: Document the RAG feature for end users
4. **Create tenant onboarding**: Automate OpenSearch stack creation for new tenants
