# Tenant Provisioning Guide

This guide explains how to provision DynamoDB tables for new tenants in the multi-tenant architecture.

## Overview

Each tenant gets their own set of DynamoDB tables to ensure complete data isolation:
- `ChatHistory-tenant-{tenantId}` - Stores chat conversations
- `TokenUsageStats-tenant-{tenantId}` - Stores token usage statistics

## Provisioning Methods

### Method 1: Using the REST API (Recommended)

The easiest way to provision a new tenant is through the REST API endpoint:

```bash
# Onboard a new tenant
curl -X POST https://your-api-gateway-url/tenants \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "acme-corp",
    "tenantName": "ACME Corporation",
    "adminEmail": "admin@acme.com"
  }'
```

Response:
```json
{
  "message": "Tenant onboarding initiated successfully",
  "tenantId": "acme-corp",
  "stackName": "TenantDynamoDB-acme-corp",
  "tables": {
    "chatHistory": "ChatHistory-tenant-acme-corp",
    "tokenUsageStats": "TokenUsageStats-tenant-acme-corp"
  }
}
```

Check tenant status:
```bash
curl -X GET https://your-api-gateway-url/tenants/acme-corp \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Method 2: Using CDK CLI

For manual provisioning or testing, you can use the CDK directly:

```bash
# Navigate to the CDK directory
cd packages/cdk

# Install dependencies
npm install

# Deploy tables for a specific tenant
cdk deploy TenantDynamoDB-acme-corp \
  --context tenantId=acme-corp
```

### Method 3: Using the Provisioning Script

A TypeScript script is provided for batch provisioning:

```bash
# Navigate to the CDK directory
cd packages/cdk

# Run the provisioning script
npm run provision-tenant -- --tenant-id acme-corp --region us-east-1

# With AWS profile
npm run provision-tenant -- --tenant-id acme-corp --profile production
```

## Tenant ID Requirements

- Must be unique across your system
- Alphanumeric characters and hyphens only
- Will be sanitized automatically (special characters replaced with hyphens)
- Recommended format: lowercase with hyphens (e.g., `acme-corp`, `tenant-123`)

## Table Configuration

### Default Settings

- **Billing Mode**: PAY_PER_REQUEST (on-demand)
- **Encryption**: AWS managed encryption (SSE)
- **Point-in-Time Recovery**: Enabled
- **Removal Policy**: RETAIN (tables are kept when stack is deleted)

### Indexes

#### ChatHistory Table
- Primary Key: `id` (HASH), `createdDate` (RANGE)
- Global Secondary Index: `FeedbackIndex` on `feedback` attribute

#### TokenUsageStats Table
- Primary Key: `id` (HASH), `userId` (RANGE)
- Global Secondary Index: `MonthIndex` on `month` (HASH), `userId` (RANGE)

## IAM Permissions

### For Tenant Onboarding

The onboarding Lambda function requires:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:DescribeStacks",
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:TagResource"
      ],
      "Resource": [
        "arn:aws:cloudformation:*:*:stack/TenantDynamoDB-*/*",
        "arn:aws:dynamodb:*:*:table/*-tenant-*"
      ]
    }
  ]
}
```

### For Application Access

Lambda functions accessing tenant tables need:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:BatchGetItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/*-tenant-*",
        "arn:aws:dynamodb:*:*:table/*-tenant-*/index/*"
      ]
    }
  ]
}
```

## Monitoring and Alerts

### CloudFormation Stack Status

Monitor stack creation through:
- AWS CloudFormation Console
- CloudWatch Events for stack state changes
- API endpoint: `GET /tenants/{tenantId}`

### Table Metrics

Key metrics to monitor per tenant:
- ConsumedReadCapacityUnits
- ConsumedWriteCapacityUnits
- UserErrors
- SystemErrors
- ThrottledRequests

## Troubleshooting

### Common Issues

1. **Stack Creation Failed**
   - Check CloudFormation events for detailed error
   - Verify IAM permissions
   - Ensure tenant ID is unique

2. **Table Already Exists**
   - Tenant might be already provisioned
   - Check with `GET /tenants/{tenantId}`

3. **Access Denied**
   - Verify Lambda execution role has correct permissions
   - Check if tenant tables exist
   - Ensure JWT contains correct tenant ID claim

### Cleanup

To remove a tenant's resources:

```bash
# Using AWS CLI
aws cloudformation delete-stack --stack-name TenantDynamoDB-acme-corp

# Or using CDK
cdk destroy TenantDynamoDB-acme-corp
```

**WARNING**: This will delete all data unless tables have RETAIN removal policy.

## Best Practices

1. **Tenant ID Naming**: Use consistent, meaningful IDs
2. **Monitoring**: Set up CloudWatch alarms for each tenant
3. **Backup**: Enable continuous backups for production tenants
4. **Cost Tracking**: Use tags to track costs per tenant
5. **Capacity Planning**: Monitor usage patterns and adjust if needed

## Migration from Shared Tables

For existing deployments using shared tables:

1. Export data from shared tables filtered by user
2. Transform data to include tenant context
3. Import into tenant-specific tables
4. Update application configuration
5. Verify data integrity
6. Switch traffic to new tables

See `migration-guide.md` for detailed steps.