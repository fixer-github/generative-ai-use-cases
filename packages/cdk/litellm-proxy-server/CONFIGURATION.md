# LiteLLM Dynamic Configuration Format

This document describes the flexible configuration format for the LiteLLM proxy server that eliminates hardcoded model names and provider configurations.

## Configuration Structure

The `LITELLM_CONFIG` environment variable accepts a JSON structure with the following format:

```json
{
  "providers": {
    "<provider-name>": {
      "enabled": true,
      "useSecretKey": true,
      "secretKey": "litellm/<provider-name>/api-key",
      "models": [
        {
          "name": "<model-alias>",
          "model": "<actual-model-name>",
          "litellm_params": {
            // Any additional LiteLLM parameters
          }
        }
      ]
    }
  },
  "general_settings": {
    // Override default general settings
  },
  "litellm_settings": {
    // Override default LiteLLM settings
  },
  "router_settings": {
    // Optional router configuration
  },
  "model_alias": {
    // Optional model aliases
  }
}
```

## Provider Configuration Examples

### OpenAI

```json
{
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
          "model": "ft:gpt-3.5-turbo:org-id:custom:id"
        }
      ]
    }
  }
}
```

### Anthropic

```json
{
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
}
```

### AWS Bedrock (IAM Authentication)

```json
{
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
          "name": "llama-3-70b",
          "model": "bedrock/meta.llama3-70b-instruct-v1:0"
        }
      ]
    }
  }
}
```

### Azure OpenAI

```json
{
  "providers": {
    "azure": {
      "enabled": true,
      "useSecretKey": true,
      "endpoint": "https://your-resource.openai.azure.com",
      "api_version": "2024-02-15-preview",
      "models": [
        {
          "name": "azure-gpt-4",
          "model": "azure/your-gpt4-deployment",
          "litellm_params": {
            "api_version": "2024-02-15-preview"
          }
        },
        {
          "name": "azure-gpt-35-turbo",
          "model": "azure/your-gpt35-deployment"
        }
      ]
    }
  }
}
```

### Google Vertex AI

```json
{
  "providers": {
    "google": {
      "enabled": true,
      "useSecretKey": true,
      "vertex_config": {
        "project": "your-gcp-project",
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
}
```

### Multiple Providers

```json
{
  "providers": {
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
    },
    "bedrock": {
      "enabled": true,
      "region": "us-west-2",
      "models": [
        {"name": "claude-instant", "model": "bedrock/anthropic.claude-instant-v1"}
      ]
    }
  },
  "model_alias": {
    "default": "gpt-3.5-turbo",
    "smart": "claude-3-opus"
  },
  "router_settings": {
    "routing_strategy": "simple-shuffle",
    "cooldown_time": 60,
    "num_retries": 2
  }
}
```

## Benefits

1. **No Hardcoding**: Model names and configurations are fully dynamic
2. **Version Flexibility**: Easy to update model versions without code changes
3. **Custom Models**: Support for fine-tuned or custom model deployments
4. **Provider Extensibility**: Easy to add new providers or models
5. **Configuration as Code**: Can be managed through infrastructure as code

## Usage

1. Set the `LITELLM_CONFIG` environment variable with your JSON configuration
2. Enable dynamic configuration with `USE_DYNAMIC_CONFIG=true`
3. The config loader will parse the configuration and generate the appropriate LiteLLM config.yaml

This approach makes the system much more maintainable and flexible, eliminating the need to modify code when model versions change or new models are added.