# Multi-Tenant Implementation Guide

## Overview

This codebase implements a multi-tenant architecture with complete data isolation between tenants. Each tenant has dedicated AWS resources (DynamoDB tables, S3 buckets, SQS queues, SNS topics, Lambda functions) following the naming pattern: `ResourceName-tenant-{tenantId}`

## Architecture

### Application-Level Multi-Tenancy
The tenant client factory provides unified access to all AWS services with automatic tenant isolation.

**Core Files:**
- `utils/tenantClientFactory.ts` - Central factory for all AWS service clients with tenant isolation
- `utils/tenantUtils.ts` - Tenant ID extraction from JWT
- `repository.ts` - Repository functions with tenant support

**How it works:**
1. User's JWT contains `custom:tenant_id` claim
2. Tenant client factory extracts tenant ID from API Gateway event
3. AssumeRoleWithWebIdentity is used to get tenant-specific credentials
4. Service clients are created with tenant credentials and cached
5. Resource names are dynamically generated: `{BaseResourceName}-tenant-{tenantId}`
6. Each tenant's resources are completely isolated

## Quick Start

### 1. Ensure User Has Tenant ID
```javascript
// User attributes must include:
{
  "custom:tenant_id": "company-a"
}
```

### 2. Create Tenant Resources
```bash
# DynamoDB table
aws dynamodb create-table \
  --table-name ChatHistory-tenant-company-a \
  --key-schema AttributeName=id,KeyType=HASH AttributeName=createdDate,KeyType=RANGE

# S3 bucket  
aws s3 mb s3://uploads-tenant-company-a

# SQS queue
aws sqs create-queue --queue-name notifications-tenant-company-a

# SNS topic
aws sns create-topic --name alerts-tenant-company-a

# Lambda function
# Deploy tenant-specific Lambda functions with naming pattern
```

### 3. Use in Lambda

#### DynamoDB Operations
```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';
import { createChat } from './repository';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer.claims['cognito:username'];
  
  // Repository handles tenant isolation automatically
  const chat = await createChat(userId, event);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ chat })
  };
};
```

#### S3 Operations
```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createTenantS3Client, getTenantResourceName } from './utils/tenantClientFactory';

export const handler = async (event: APIGatewayProxyEvent) => {
  // Get S3 client with tenant credentials
  const s3Client = await createTenantS3Client(event);
  
  // Get tenant-specific bucket name
  const bucketName = getTenantResourceName('uploads', event);
  
  // Upload file to tenant bucket
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'document.pdf',
    Body: Buffer.from(event.body, 'base64'),
  }));
  
  return { statusCode: 200 };
};
```

#### SQS Operations
```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTenantSQSClient, getTenantResourceName } from './utils/tenantClientFactory';

export const handler = async (event: APIGatewayProxyEvent) => {
  // Get SQS client with tenant credentials
  const sqsClient = await createTenantSQSClient(event);
  
  // Get tenant-specific queue URL
  const queueName = getTenantResourceName('notifications', event);
  const queueUrl = `https://sqs.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${queueName}`;
  
  // Send message to tenant queue
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ message: 'Hello tenant!' }),
  }));
  
  return { statusCode: 200 };
};
```

## Resource Naming

All tenant resources MUST follow this pattern:
- DynamoDB: `{TableName}-tenant-{tenantId}`
- S3: `{BucketPrefix}-tenant-{tenantId}`
- SQS: `{QueueName}-tenant-{tenantId}`
- SNS: `{TopicName}-tenant-{tenantId}`
- Lambda: `{FunctionName}-tenant-{tenantId}`

## Security

- Each tenant's data is completely isolated
- IAM policies prevent cross-tenant access
- JWT token must contain `custom:tenant_id` claim
- CloudTrail logs all access with tenant context

## Migration Checklist

- [ ] Add `custom:tenant_id` to all users
- [ ] Create tenant-specific tables/buckets
- [ ] Update Lambda functions to pass event parameter
- [ ] Test with multiple tenants
- [ ] Monitor CloudWatch for access errors

## Environment Variables

```yaml
TABLE_NAME: ChatHistory  # Base name (without tenant suffix)
STATS_TABLE_NAME: TokenUsageStats
MULTI_TENANT_ROLE_ARN: arn:aws:iam::123456789:role/MultiTenantAccessRole
DEFAULT_TENANT_ID: default  # For backwards compatibility
BASE_BUCKET_NAME: uploads  # Base name for S3 buckets
BASE_QUEUE_NAME: notifications  # Base name for SQS queues
BASE_TOPIC_NAME: alerts  # Base name for SNS topics
```

## Troubleshooting

1. **"Access Denied" errors**: Check tenant ID in JWT and resource naming
2. **Missing credentials**: Ensure MULTI_TENANT_ROLE_ARN is set
3. **Performance issues**: Check credential cache hit rate in logs