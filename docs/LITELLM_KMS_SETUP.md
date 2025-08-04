# LiteLLM KMS Secret Management Setup Guide

This guide explains how to set up and use LiteLLM with AWS Key Management Service (KMS) for secure API key management in the Generative AI Use Cases application.

## Overview

LiteLLM secret management with AWS KMS V1 provides:
- Centralized encryption and storage of API keys
- Automatic key rotation capabilities
- Multi-provider support (OpenAI, Anthropic, Azure, etc.)
- Virtual key generation for temporary access
- Audit logging and monitoring

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Lambda Func   │────▶│   AWS KMS       │────▶│ Secrets Manager │
│  (LiteLLM)      │     │   (Encryption)  │     │  (Storage)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                │
        └───────────────────────────────────────────────┘
                    Decrypted API Keys
```

## Prerequisites

- AWS CDK v2.x installed
- AWS CLI configured with appropriate credentials
- Node.js 18.x or later
- TypeScript 5.x or later

## Configuration

### 1. Enable LiteLLM in CDK Context

Update your `cdk.json` file to enable LiteLLM:

```json
{
  "context": {
    "litellm": {
      "enabled": true,
      "kms": {
        "keyAlias": "alias/litellm-master",
        "enableKeyRotation": true,
        "pendingWindowInDays": 7,
        "enableAuditLog": true,
        "secretRotationDays": 90
      },
      "providers": {
        "openai": {
          "enabled": true,
          "secretKey": "OPENAI_API_KEY",
          "modelPrefix": "openai"
        },
        "anthropic": {
          "enabled": true,
          "secretKey": "ANTHROPIC_API_KEY",
          "modelPrefix": "anthropic"
        },
        "bedrock": {
          "enabled": true,
          "useIAMRole": true,
          "modelPrefix": "bedrock"
        }
      }
    }
  }
}
```

### 2. Store API Keys in AWS Secrets Manager

After deployment, store your API keys in AWS Secrets Manager:

```bash
# Store OpenAI API key
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-your-openai-api-key"

# Store Anthropic API key
aws secretsmanager put-secret-value \
  --secret-id litellm/anthropic/api-key \
  --secret-string "sk-ant-your-anthropic-api-key"

# For Azure OpenAI (if enabled)
aws secretsmanager put-secret-value \
  --secret-id litellm/azure/api-key \
  --secret-string "your-azure-api-key"
```

### 3. Deploy the Stack

Deploy the LiteLLM KMS stack:

```bash
npm run cdk:deploy
```

## Usage in Lambda Functions

### Basic Usage

```typescript
import { getLiteLLMKmsClient } from './utils/litellmKmsClient';

export const handler = async (event: any) => {
  // Initialize LiteLLM KMS client
  const litellmClient = await getLiteLLMKmsClient();
  
  // Get decrypted API key for a provider
  const openaiKey = await litellmClient.getProviderApiKey('openai');
  
  // Get full configuration
  const config = await litellmClient.getConfiguration();
  
  // Build model configuration for LiteLLM proxy
  const models = await litellmClient.buildModelConfig();
  
  // Use with LiteLLM
  // ... your LiteLLM code here
};
```

### Grant Permissions to Lambda

In your CDK stack:

```typescript
import { LiteLLMKms } from './construct/litellm-kms';

// Create LiteLLM KMS construct
const litellmKms = new LiteLLMKms(this, 'LiteLLMKms', {
  kmsKey: kmsStack.kmsKey,
  providers: {
    openai: { enabled: true, secretKey: 'OPENAI_API_KEY' },
    anthropic: { enabled: true, secretKey: 'ANTHROPIC_API_KEY' },
  },
});

// Grant read permissions to your Lambda function
litellmKms.grantRead(yourLambdaFunction);
```

## Virtual Keys

Virtual keys allow temporary access to LiteLLM with specific permissions:

```typescript
// Grant virtual key management permissions
litellmKms.grantVirtualKeyManagement(virtualKeyLambda);

// In your Lambda function
const litellmClient = await getLiteLLMKmsClient();

// Create a virtual key
const virtualKey = await createVirtualKey({
  userId: 'user123',
  expiresIn: 86400, // 24 hours
  models: ['gpt-4', 'claude-3'],
  metadata: {
    department: 'engineering',
    project: 'chatbot'
  }
});
```

## Security Best Practices

1. **Least Privilege Access**: Only grant necessary permissions to Lambda functions
2. **Key Rotation**: Enable automatic rotation for API keys (default: 90 days)
3. **Audit Logging**: Monitor CloudTrail for all KMS operations
4. **Network Isolation**: Use VPC endpoints for Secrets Manager access
5. **Environment Separation**: Use different KMS keys for dev/staging/prod

## Monitoring and Alerts

The stack automatically creates CloudWatch alarms for:
- Failed KMS decryption attempts (threshold: 10 in 5 minutes)
- High error rates in API calls
- Unusual usage patterns

View metrics in CloudWatch under the `LiteLLM/Proxy` namespace.

## Cost Optimization

1. **Caching**: Decrypted keys are cached for 1 hour to reduce KMS API calls
2. **Routing Strategy**: Configure `least-cost` routing to minimize API costs
3. **Fallbacks**: Enable fallbacks to alternative providers during outages

## Troubleshooting

### Common Issues

1. **KMS Access Denied**
   - Check Lambda execution role has `kms:Decrypt` permission
   - Verify KMS key policy allows the Lambda role

2. **Secret Not Found**
   - Ensure secret exists in Secrets Manager
   - Check secret name matches configuration

3. **Initialization Failures**
   - Verify environment variables are set correctly
   - Check CloudWatch logs for detailed error messages

### Debug Mode

Enable debug logging:

```typescript
process.env.LITELLM_DEBUG = 'true';
```

## Updating API Keys

To update an API key:

```bash
# Update the secret value
aws secretsmanager update-secret \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-new-api-key"

# The change will be picked up automatically after cache expiry (1 hour)
# Or restart your Lambda functions to force immediate update
```

## Compliance and Auditing

All KMS operations are logged in CloudTrail. To view audit logs:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=alias/litellm-master \
  --max-items 10
```

## Support

For issues or questions:
- Check CloudWatch logs for detailed error messages
- Review the [LiteLLM documentation](https://docs.litellm.ai/)
- Open an issue in the project repository