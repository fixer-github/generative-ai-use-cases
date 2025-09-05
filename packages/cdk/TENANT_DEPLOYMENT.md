# Tenant-Specific Stack Deployment Guide

## Phase 1: Account Isolation Multi-tenancy

This guide explains how to deploy tenant-specific infrastructure stacks with Phase 1 account isolation multi-tenancy support.

## Prerequisites

1. **Main Stack Deployed**: The main generative AI use cases stack must be deployed first
2. **Cognito Resources**: You need the User Pool ID and Identity Pool ID from the main stack

## Getting Required Parameters

After deploying the main stack, retrieve these values from the CloudFormation outputs:

```bash
# Get User Pool ID from main stack outputs
aws cloudformation describe-stacks \
  --stack-name <MAIN_STACK_NAME> \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text

# Get Identity Pool ID from main stack outputs  
aws cloudformation describe-stacks \
  --stack-name <MAIN_STACK_NAME> \
  --query 'Stacks[0].Outputs[?OutputKey==`IdPoolId`].OutputValue' \
  --output text
```

## Configuration

1. **Copy the example configuration**:
   ```bash
   cp cdk.tenant.example.json cdk.tenant.json
   ```

2. **Update `cdk.tenant.json`** with your tenant-specific values:
   ```json
   {
     "context": {
       "tenantId": "your-tenant-id",
       "environment": "dev",
       "tenantRegion": "us-east-1",
       "enableAutoDelete": false,
       "userPoolId": "us-east-1_XXXXXXXXX",
       "identityPoolId": "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
     }
   }
   ```

   **Note**: `userPoolId` and `identityPoolId` are **required** and must be set in the context file or provided via command line. These values are used directly as CDK context variables, not CloudFormation parameters.

## Deployment Options

### Option 1: Using CDK Context File (Recommended)

Deploy with tenant configuration from `cdk.tenant.json`:

```bash
npx cdk deploy --app "npx ts-node bin/generative-ai-use-cases-tenant.ts"
```

The `userPoolId` and `identityPoolId` from the context file are used directly by CDK.

### Option 2: Using Command Line Context

Override or provide context values via command line:

```bash
npx cdk deploy --app "npx ts-node bin/generative-ai-use-cases-tenant.ts" \
  --context tenantId=tenant123 \
  --context userPoolId=us-east-1_XXXXXXXXX \
  --context identityPoolId=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Option 3: Mixed Context

Use context file for tenant settings and override specific values:

```bash
npx cdk deploy --app "npx ts-node bin/generative-ai-use-cases-tenant.ts" \
  --context userPoolId=us-east-1_NEWVALUE
```

## Generated Resources

The tenant deployment creates the following stacks:

### TenantIAMStack-{environment}-{tenantId}
- **Tenant-specific IAM role** for AssumeRoleWithWebIdentity authentication
- **Resource-specific policies** for S3, DynamoDB, Bedrock, and other AWS services
- **Cross-tenant access prevention** with explicit deny policies

### TenantDynamoDBStack-{environment}-{tenantId}  
- **ChatHistory table** with tenant-specific naming
- **TokenUsageStats table** for usage tracking
- **UseCaseBuilder table** for custom use case definitions

### TenantS3Stack-{environment}-{tenantId}
- **File storage bucket** with tenant-specific naming and policies
- **CORS configuration** for web application access
- **Lifecycle policies** for cost optimization

## Stack Outputs

Each stack provides CloudFormation exports that can be referenced by other stacks:

```bash
# List all exports for a tenant
aws cloudformation list-exports \
  --query 'Exports[?contains(Name, `tenant123`)]'

# Get tenant role ARN
aws cloudformation list-exports \
  --query 'Exports[?contains(Name, `TenantRoleArn`)].Value' \
  --output text
```

## Verification

After deployment, verify the tenant isolation:

1. **Check IAM Role**: Confirm the tenant role can only access tenant-specific resources
2. **Test S3 Access**: Verify bucket policies restrict cross-tenant access  
3. **Validate DynamoDB**: Ensure table names include tenant ID
4. **Review CloudFormation**: Check all resources have proper tenant tags

## Cleanup

To remove tenant-specific resources:

```bash
# Delete all tenant stacks (order matters due to dependencies)
npx cdk destroy TenantS3Stack{environment}-{tenantId}
npx cdk destroy TenantDynamoDBStack{environment}-{tenantId}  
npx cdk destroy TenantIAMStack{environment}-{tenantId}
```

## Troubleshooting

### Common Issues

1. **Missing UserPool/IdentityPool**: Ensure the main stack is deployed and IDs are correct
   - Solution: Set `userPoolId` and `identityPoolId` in `cdk.tenant.json`
2. **Permission Errors**: Verify your AWS credentials have sufficient permissions
3. **Stack Dependencies**: Deploy IAM stack first, then DynamoDB and S3 stacks
4. **Context Values Missing**: CDK throwing errors about missing context values
   - Solution: Ensure `userPoolId` and `identityPoolId` are set in `cdk.tenant.json` or provided via `--context`

### Debug Mode

Enable CDK debug logging:

```bash
export CDK_DEBUG=true
npx cdk deploy --app "npx ts-node bin/generative-ai-use-cases-tenant.ts" --verbose
```