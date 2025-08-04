# LiteLLM KMS Secret Management Setup Guide

This guide explains how to set up and use LiteLLM with AWS Key Management Service (KMS) for secure API key management in the Generative AI Use Cases application.

## Overview

LiteLLM secret management with AWS KMS V1 provides:

- Centralized encryption and storage of API keys
- Dynamic configuration generation (no static config files)
- Automatic key rotation capabilities
- Multi-provider support (OpenAI, Anthropic, Azure, etc.)
- Virtual key generation for temporary access
- Audit logging and monitoring
- No redeployment needed for configuration changes

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Lambda Func   │────▶│   AWS KMS       │────▶│ Secrets Manager │
│  (LiteLLM)      │     │   (Encryption)  │     │  (Storage)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                │
        └───────────────────────────────────────────────┘
                    Decrypted API Keys
                            │
                            ▼
                ┌─────────────────────┐
                │  Config Generator   │
                │  (Dynamic YAML)     │
                └─────────────────────┘
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
      },
      "virtualKeys": {
        "enabled": true,
        "prefix": "litellm_vk_",
        "defaultExpiry": 2592000
      },
      "routing": {
        "strategy": "least-cost",
        "enableFallbacks": true,
        "defaultProvider": "openai"
      }
    }
  }
}
```

### 2. Environment Variables - What NOT to Configure

**IMPORTANT**: With our KMS integration, you should NEVER set these environment variables directly:

❌ **DO NOT SET THESE**:

```bash
# API Keys - These are managed by KMS/Secrets Manager
export OPENAI_API_KEY="sk-..."           # ❌ Never set directly
export ANTHROPIC_API_KEY="sk-ant-..."    # ❌ Never set directly
export AZURE_API_KEY="..."               # ❌ Never set directly
export GOOGLE_API_KEY="..."              # ❌ Never set directly

# LiteLLM Config - These are auto-configured
export LITELLM_MASTER_KEY="..."          # ❌ Auto-generated
export LITELLM_CONFIG_PATH="..."         # ❌ Dynamic generation
export LITELLM_KEY_MANAGEMENT_SYSTEM="..." # ❌ Set to aws_kms automatically
```

✅ **AUTOMATICALLY CONFIGURED**:

```bash
# These are set automatically by the CDK construct:
LITELLM_MASTER_KEY=<encrypted>           # ✅ Encrypted by KMS
LITELLM_KEY_MANAGEMENT_SYSTEM=aws_kms    # ✅ Auto-configured
KMS_KEY_ID=arn:aws:kms:...              # ✅ From CDK deployment
LITELLM_CONFIG_SECRET_ARN=arn:aws:...   # ✅ Config location
AWS_REGION_NAME=us-east-1               # ✅ From AWS environment
```

✅ **OPTIONAL ENVIRONMENT VARIABLES YOU CAN SET**:

```bash
# Debug and logging
export LITELLM_DEBUG=true               # Enable debug logging
export LITELLM_LOG_LEVEL=INFO          # Log level (DEBUG, INFO, WARN, ERROR)

# Cache settings (if not using defaults)
export LITELLM_CACHE_TTL=7200          # Cache TTL in seconds (default: 3600)
export LITELLM_CACHE_BACKEND=redis     # Cache backend (default: in-memory)
```

### 3. Common Mistakes to Avoid

#### ❌ **WRONG: Setting API keys in Lambda environment variables**

```typescript
// DON'T DO THIS
new lambda.Function(this, 'MyFunction', {
  environment: {
    OPENAI_API_KEY: 'sk-...', // ❌ Exposed in CloudFormation
    ANTHROPIC_API_KEY: 'sk-ant-...', // ❌ Visible in console
  },
});
```

#### ✅ **CORRECT: Use LiteLLM KMS construct**

```typescript
// DO THIS INSTEAD
const litellmKms = new LiteLLMKms(this, 'LiteLLM', {
  kmsKey: kmsStack.kmsKey,
  providers: {
    /* config */
  },
});

litellmKms.grantRead(myFunction); // ✅ Secure access
```

#### ❌ **WRONG: Hardcoding config file path**

```bash
# DON'T DO THIS
export LITELLM_CONFIG_PATH="/path/to/config.yaml"  # ❌ Static file
```

#### ✅ **CORRECT: Use dynamic configuration**

```typescript
// Configuration is generated dynamically
const config = await LiteLLMConfigGenerator.generateProxyConfig();
```

### 4. Store API Keys in AWS Secrets Manager

After deployment, store your API keys in AWS Secrets Manager:

**IMPORTANT**: Store only the plain API key string, not JSON or any other format.

```bash
# Store OpenAI API key (just the key, no JSON wrapper)
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-proj-abcd1234..."  # ✅ Plain key only

# Store Anthropic API key
aws secretsmanager put-secret-value \
  --secret-id litellm/anthropic/api-key \
  --secret-string "sk-ant-api03-abcd1234..."  # ✅ Plain key only

# For Azure OpenAI (if enabled)
aws secretsmanager put-secret-value \
  --secret-id litellm/azure/api-key \
  --secret-string "1234567890abcdef..."  # ✅ Plain key only

# ❌ DON'T store as JSON like this:
# --secret-string '{"api_key": "sk-..."}' # Wrong format!
```

**Note**: AWS Secrets Manager automatically encrypts these keys using the KMS key we created.

### 5. Deploy the Stack

Deploy the LiteLLM KMS stack:

```bash
npm run cdk:deploy
```

## Dynamic Configuration Generation

Unlike traditional approaches that require static YAML files, our implementation generates LiteLLM configuration dynamically:

### Generate Configuration Endpoint

```typescript
// GET /litellm/config?format=yaml
// Returns dynamically generated YAML configuration

// GET /litellm/config?format=json
// Returns JSON configuration
```

This approach:

- ✅ No static config files to maintain
- ✅ No redeployment when changing providers
- ✅ Configuration always in sync with secrets
- ✅ Single source of truth (cdk.json)

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
    project: 'chatbot',
  },
});
```

## Security Comparison

### Traditional Approach vs KMS Approach

| Aspect                    | Traditional (❌)                          | KMS Integration (✅)                     |
| ------------------------- | ----------------------------------------- | ---------------------------------------- |
| **API Key Storage**       | Environment variables or config files     | Encrypted in AWS Secrets Manager         |
| **Key Visibility**        | Visible in CloudFormation, Lambda console | Never exposed, only encrypted references |
| **Key Rotation**          | Manual process, requires redeployment     | Automatic rotation without redeployment  |
| **Access Control**        | All-or-nothing Lambda access              | Fine-grained IAM policies per key        |
| **Audit Trail**           | Limited or none                           | Full CloudTrail logging                  |
| **Configuration Updates** | Requires code changes and deployment      | Dynamic updates via Secrets Manager      |
| **Multi-Provider Keys**   | Scattered across multiple env vars        | Centralized management                   |
| **Cost**                  | Free but insecure                         | ~$1.30/month for enterprise security     |

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
