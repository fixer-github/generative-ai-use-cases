# Multi-Tenant IAM with AssumeRoleWithWebIdentity

This guide explains how to implement tenant-isolated access to AWS resources using IAM roles with AssumeRoleWithWebIdentity.

## Overview

The multi-tenant IAM solution provides:
- **Tenant Isolation**: Each tenant can only access their own data
- **Dynamic Permissions**: Permissions are evaluated at runtime based on JWT claims
- **Scalable Architecture**: No need to create separate resources per tenant
- **Security**: Uses AWS IAM's native security features

## Architecture

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│   Client    │──────▶│ Identity     │──────▶│   AWS STS   │
│ Application │       │ Provider     │       │             │
└─────────────┘       │ (Cognito/    │       └─────────────┘
                      │  OIDC)       │              │
                      └──────────────┘              ▼
                                              ┌─────────────┐
                                              │  IAM Role   │
                                              │ (Tenant)    │
                                              └─────────────┘
                                                     │
                                    ┌────────────────┴────────────────┐
                                    ▼                                 ▼
                              ┌──────────┐                      ┌──────────┐
                              │ DynamoDB │                      │    S3    │
                              │  Table   │                      │  Bucket  │
                              └──────────┘                      └──────────┘
```

## Key Components

### 1. MultiTenantIam Construct

The CDK construct that creates:
- IAM role with web identity trust policy
- Managed policy with tenant-specific conditions
- Resource access policies for DynamoDB and S3

### 2. Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:cognito-idp:region:account:userpool/pool-id"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "cognito-idp.region.amazonaws.com/pool-id:aud": "client-id"
      }
    }
  }]
}
```

### 3. Tenant Isolation Policies

#### DynamoDB Policy
```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", ...],
  "Resource": ["arn:aws:dynamodb:region:account:table/TableName"],
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["${cognito-idp.region.amazonaws.com/pool-id:custom:tenant_id}"]
    }
  }
}
```

#### S3 Policy
```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", ...],
  "Resource": ["arn:aws:s3:::bucket/tenants/${cognito-idp.region.amazonaws.com/pool-id:custom:tenant_id}/*"]
}
```

## Deployment

### Prerequisites
- AWS CDK installed
- AWS credentials configured
- Node.js 14+ installed

### Deploy the Stack

```bash
# Install dependencies
cd packages/cdk
npm install

# Deploy the multi-tenant IAM stack
npx cdk deploy MultiTenantIamStack \
  --parameters IdentityProviderArn=arn:aws:cognito-idp:region:account:userpool/pool-id \
  --parameters Audience=your-client-id
```

### With Existing Cognito User Pool

```typescript
const stack = new MultiTenantIamStack(app, 'MultiTenantIamStack', {
  userPoolId: 'us-east-1_XXXXXXXXX',
  identityProviderName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX',
  audience: 'your-app-client-id',
});
```

## Usage Examples

### 1. Client-Side Token Exchange

```javascript
// Obtain ID token from Cognito
const idToken = await getIdTokenFromCognito();

// Exchange for temporary credentials
const sts = new AWS.STS();
const params = {
  RoleArn: 'arn:aws:iam::account:role/TenantRole',
  RoleSessionName: `tenant-session-${tenantId}`,
  WebIdentityToken: idToken,
  DurationSeconds: 3600,
};

const credentials = await sts.assumeRoleWithWebIdentity(params).promise();
```

### 2. Lambda Function Usage

```typescript
import { TenantDataAccess } from './multi-tenant-data-access';

const tenantAccess = new TenantDataAccess({
  roleArn: process.env.TENANT_ROLE_ARN,
  tableName: process.env.TENANT_TABLE_NAME,
  bucketName: process.env.TENANT_BUCKET_NAME,
});

// In your handler
const credentials = await tenantAccess.assumeTenantRole(webIdentityToken, tenantId);
const { docClient, s3Client } = tenantAccess.createTenantClients(credentials);

// Now use the clients with tenant-specific access
const data = await tenantAccess.queryTenantData(docClient, tenantId);
```

### 3. DynamoDB Table Design

For proper tenant isolation, use tenant ID as the partition key:

```typescript
const table = new dynamodb.Table(this, 'TenantData', {
  partitionKey: {
    name: 'tenantId',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'dataId',
    type: dynamodb.AttributeType.STRING,
  },
});
```

### 4. S3 Bucket Structure

Organize files by tenant:
```
bucket/
├── tenants/
│   ├── tenant-123/
│   │   ├── documents/
│   │   └── images/
│   └── tenant-456/
│       ├── documents/
│       └── images/
```

## Security Best Practices

1. **Token Validation**: Always validate JWT tokens before using them
2. **Least Privilege**: Grant only necessary permissions
3. **Audit Logging**: Enable CloudTrail for all API calls
4. **Encryption**: Use encryption at rest for DynamoDB and S3
5. **Session Duration**: Keep session duration short (1 hour recommended)
6. **Token Refresh**: Implement token refresh logic in your application

## Customization

### Adding Custom Claims

Configure your identity provider to include custom claims:

```javascript
// Cognito example
{
  "custom:tenant_id": "tenant-123",
  "custom:role": "admin",
  "custom:permissions": ["read", "write"]
}
```

### Extending Permissions

Add more services to the tenant role:

```typescript
multiTenantIam.grantAdditionalPermissions(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['secretsmanager:GetSecretValue'],
    resources: [`arn:aws:secretsmanager:*:*:secret:${tenantId}/*`],
  })
);
```

## Troubleshooting

### Common Issues

1. **Access Denied**: Check that the tenant ID claim matches the resource prefix
2. **Invalid Token**: Ensure the token hasn't expired and is from the correct provider
3. **Role Trust**: Verify the identity provider ARN in the trust policy

### Debug Commands

```bash
# Test assume role
aws sts assume-role-with-web-identity \
  --role-arn arn:aws:iam::account:role/TenantRole \
  --role-session-name test-session \
  --web-identity-token $TOKEN

# Decode JWT token
echo $TOKEN | cut -d. -f2 | base64 -d | jq
```

## Cost Optimization

1. Use DynamoDB on-demand billing for variable workloads
2. Implement S3 lifecycle policies for tenant data
3. Monitor and set up alarms for unusual access patterns
4. Use AWS Cost Explorer to track per-tenant costs via tags

## Next Steps

1. Implement monitoring and alerting
2. Add API Gateway with Cognito authorizer
3. Create tenant onboarding automation
4. Implement data retention policies
5. Add cross-region replication for disaster recovery