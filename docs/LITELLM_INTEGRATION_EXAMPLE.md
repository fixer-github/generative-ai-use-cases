# LiteLLM KMS Stack Integration Example

This document shows how to integrate the LiteLLM KMS stack with the main application stack.

## Integration in Main Stack

In `packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`:

```typescript
import { LiteLLMKmsStack } from './litellm-kms-stack';
import { LiteLLMKms } from '../../construct/litellm-kms';

export class GenerativeAIUseCasesStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const params = getParameters(this);

    // ... existing code ...

    // Create LiteLLM KMS Stack if enabled
    let litellmKms: LiteLLMKms | undefined;
    
    if (params.litellm?.enabled) {
      // Create the KMS key stack
      const litellmKmsStack = new LiteLLMKmsStack(this, 'LiteLLMKmsStack', {
        envSuffix: params.env,  // This ensures env isolation
        enableKeyRotation: params.litellm.kms.enableKeyRotation,
        pendingWindowInDays: params.litellm.kms.pendingWindowInDays,
      });

      // Create the LiteLLM KMS construct
      litellmKms = new LiteLLMKms(this, 'LiteLLMKms', {
        kmsKey: litellmKmsStack.kmsKey,
        providers: params.litellm.providers,
        envSuffix: params.env,  // This ensures secret names include env
        enableVirtualKeys: params.litellm.virtualKeys.enabled,
        virtualKeyPrefix: params.litellm.virtualKeys.prefix,
        defaultProvider: params.litellm.routing.defaultProvider,
        secretRotationDays: params.litellm.kms.secretRotationDays,
      });

      // Grant permissions to API Lambda functions
      litellmKms.grantRead(api.predictFunction);
      litellmKms.grantRead(api.generateFunction);
      // ... grant to other Lambda functions as needed
    }
  }
}
```

## How env Suffix Works

The `env` field from the CDK context affects the LiteLLM KMS stack in several ways:

### 1. KMS Key Alias
- Without env: `alias/litellm-master`
- With env "dev": `alias/litellm-master-dev`
- With env "prod": `alias/litellm-master-prod`

### 2. Secret Names in Secrets Manager
- Without env: 
  - `litellm/openai/api-key`
  - `litellm/config`
- With env "dev":
  - `litellm-dev/openai/api-key`
  - `litellm-dev/config`
- With env "prod":
  - `litellm-prod/openai/api-key`
  - `litellm-prod/config`

### 3. CloudFormation Export Names
- Without env: `LiteLLMKmsStack-KmsKeyId`
- With env: `LiteLLMKmsStack-dev-KmsKeyId`

## Environment Isolation Benefits

1. **Complete Separation**: Each environment (dev, staging, prod) has its own:
   - KMS keys
   - API key secrets
   - Configuration

2. **Security**: 
   - Dev environment cannot access prod secrets
   - Different IAM policies per environment
   - Separate audit trails

3. **Cost Tracking**:
   - Environment-specific cost allocation tags
   - Separate CloudWatch metrics per environment

4. **Deployment Safety**:
   - Can deploy/update one environment without affecting others
   - Different rotation schedules per environment

## Example CDK Context Configuration

```json
{
  "context": {
    "env": "dev",  // This affects LiteLLM resource naming
    "litellm": {
      "enabled": true,
      "kms": {
        "keyAlias": "alias/litellm-master",
        "enableKeyRotation": true,
        "pendingWindowInDays": 7
      },
      "providers": {
        "openai": {
          "enabled": true,
          "secretKey": "OPENAI_API_KEY"
        }
      }
    }
  }
}
```

With `env: "dev"`, this creates:
- KMS alias: `alias/litellm-master-dev`
- Secret: `litellm-dev/openai/api-key`
- Config: `litellm-dev/config`

## Storing Secrets Per Environment

```bash
# For dev environment
aws secretsmanager put-secret-value \
  --secret-id litellm-dev/openai/api-key \
  --secret-string "sk-dev-api-key"

# For prod environment  
aws secretsmanager put-secret-value \
  --secret-id litellm-prod/openai/api-key \
  --secret-string "sk-prod-api-key"
```