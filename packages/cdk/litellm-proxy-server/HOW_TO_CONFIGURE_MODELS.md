# How to Configure Models in LiteLLM Proxy Server

Now that we've removed all hardcoding, models are configured entirely through the CDK configuration in `cdk.json`. This guide explains how to set up different LLM providers and their models.

## Overview

The LiteLLM proxy server now requires all model configurations to be provided through the `litellm` section in your `cdk.json` file. The configuration is passed to the proxy server via the `LITELLM_CONFIG` environment variable.

## Configuration Structure

In your `cdk.json`:

```json
{
  "context": {
    "litellmProxyEnabled": true,
    "litellm": {
      "enabled": true,
      "providers": {
        "<provider-name>": {
          "enabled": true,
          "models": [
            {
              "name": "<model-alias>",
              "model": "<actual-model-identifier>"
            }
          ]
        }
      }
    }
  }
}
```

## Provider Examples

### 1. AWS Bedrock (No API Key Required)

Bedrock uses IAM role authentication, so no API key is needed:

```json
"providers": {
  "bedrock": {
    "enabled": true,
    "region": "us-east-1",
    "models": [
      {
        "name": "claude-3-5-sonnet",
        "model": "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
      },
      {
        "name": "claude-3-5-haiku",
        "model": "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0"
      },
      {
        "name": "nova-pro",
        "model": "bedrock/amazon.nova-pro-v1:0"
      },
      {
        "name": "llama3-70b",
        "model": "bedrock/meta.llama3-70b-instruct-v1:0"
      }
    ]
  }
}
```

### 2. OpenAI (Requires API Key)

```json
"providers": {
  "openai": {
    "enabled": true,
    "useSecretKey": true,
    "secretKey": "litellm/openai/api-key",
    "models": [
      {
        "name": "gpt-4",
        "model": "gpt-4"
      },
      {
        "name": "gpt-4-turbo",
        "model": "gpt-4-turbo-preview"
      },
      {
        "name": "gpt-3.5-turbo",
        "model": "gpt-3.5-turbo"
      },
      {
        "name": "custom-fine-tuned",
        "model": "ft:gpt-3.5-turbo:your-org:custom:abc123"
      }
    ]
  }
}
```

After deployment, store the API key:

```bash
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-proj-your-api-key-here"
```

### 3. Anthropic (Requires API Key)

```json
"providers": {
  "anthropic": {
    "enabled": true,
    "useSecretKey": true,
    "models": [
      {
        "name": "claude-3-opus",
        "model": "claude-3-opus-20240229"
      },
      {
        "name": "claude-3-sonnet",
        "model": "claude-3-sonnet-20240229"
      },
      {
        "name": "claude-3-haiku",
        "model": "claude-3-haiku-20240307"
      }
    ]
  }
}
```

### 4. Azure OpenAI (Requires API Key and Endpoint)

```json
"providers": {
  "azure": {
    "enabled": true,
    "useSecretKey": true,
    "endpoint": "https://your-resource.openai.azure.com",
    "api_version": "2024-02-15-preview",
    "models": [
      {
        "name": "azure-gpt-4",
        "model": "azure/your-deployment-name"
      },
      {
        "name": "azure-gpt-35",
        "model": "azure/your-gpt35-deployment"
      }
    ]
  }
}
```

### 5. Google Vertex AI

```json
"providers": {
  "google": {
    "enabled": true,
    "useSecretKey": true,
    "vertex_config": {
      "project": "your-gcp-project-id",
      "location": "us-central1"
    },
    "models": [
      {
        "name": "gemini-pro",
        "model": "gemini-pro"
      },
      {
        "name": "gemini-pro-vision",
        "model": "gemini-pro-vision"
      }
    ]
  }
}
```

### 6. Multiple Providers Together

```json
"providers": {
  "bedrock": {
    "enabled": true,
    "region": "us-east-1",
    "models": [
      {"name": "claude-3-5-sonnet", "model": "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"},
      {"name": "nova-pro", "model": "bedrock/amazon.nova-pro-v1:0"}
    ]
  },
  "openai": {
    "enabled": true,
    "useSecretKey": true,
    "models": [
      {"name": "gpt-4", "model": "gpt-4"},
      {"name": "gpt-3.5-turbo", "model": "gpt-3.5-turbo"}
    ]
  },
  "anthropic": {
    "enabled": true,
    "useSecretKey": true,
    "models": [
      {"name": "claude-3-opus", "model": "claude-3-opus-20240229"}
    ]
  }
}
```

## Advanced Configuration

### Model Aliases

You can set up aliases to redirect requests:

```json
"model_alias": {
  "gpt-4": "claude-3-5-sonnet",
  "default": "gpt-3.5-turbo"
}
```

### Router Settings

Configure load balancing and failover:

```json
"router_settings": {
  "routing_strategy": "simple-shuffle",
  "cooldown_time": 60,
  "num_retries": 2,
  "allowed_fails": 3
}
```

### Custom Model Parameters

You can add custom LiteLLM parameters to any model:

```json
{
  "name": "gpt-4-custom",
  "model": "gpt-4",
  "litellm_params": {
    "temperature": 0.7,
    "max_tokens": 2000,
    "top_p": 0.9
  }
}
```

## Complete Example

Here's a complete `cdk.json` example:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/generative-ai-use-cases.ts",
  "context": {
    "litellmProxyEnabled": true,
    "litellm": {
      "enabled": true,
      "kms": {
        "keyAlias": "alias/litellm-master",
        "enableKeyRotation": true
      },
      "providers": {
        "bedrock": {
          "enabled": true,
          "region": "us-east-1",
          "models": [
            {
              "name": "claude-3-5-sonnet",
              "model": "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
            },
            {
              "name": "claude-3-5-haiku",
              "model": "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0"
            },
            { "name": "nova-pro", "model": "bedrock/amazon.nova-pro-v1:0" }
          ]
        },
        "openai": {
          "enabled": false,
          "useSecretKey": true,
          "models": [
            { "name": "gpt-4", "model": "gpt-4" },
            { "name": "gpt-3.5-turbo", "model": "gpt-3.5-turbo" }
          ]
        }
      },
      "model_alias": {
        "gpt-4": "claude-3-5-sonnet"
      },
      "router_settings": {
        "routing_strategy": "simple-shuffle"
      }
    }
  }
}
```

## Deployment Steps

1. **Configure models in cdk.json** (as shown above)

2. **Deploy the infrastructure**:

   ```bash
   npm run cdk:deploy
   ```

3. **Store API keys** (for non-Bedrock providers):

   ```bash
   # Store master key (required)
   aws secretsmanager put-secret-value \
     --secret-id litellm/master-key \
     --secret-string "sk-litellm-your-secure-master-key"

   # Store provider API keys
   aws secretsmanager put-secret-value \
     --secret-id litellm/openai/api-key \
     --secret-string "sk-proj-your-openai-key"
   ```

4. **Test the deployment**:
   ```bash
   curl https://your-function-url.lambda-url.region.on.aws/health
   ```

## Benefits of This Approach

1. **No Hardcoding**: All models are defined in configuration
2. **Easy Updates**: Add or remove models without changing code
3. **Version Control**: Model configurations are tracked in `cdk.json`
4. **Secure**: API keys are encrypted in AWS Secrets Manager
5. **Flexible**: Support for any LiteLLM-compatible model

## Troubleshooting

- If the proxy fails to start, check CloudWatch logs for configuration errors
- Ensure all required API keys are stored in Secrets Manager
- Verify IAM roles have access to Secrets Manager and KMS
- For Bedrock, ensure the Lambda role has bedrock:InvokeModel permissions
