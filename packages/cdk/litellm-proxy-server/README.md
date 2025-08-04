# LiteLLM Proxy Server for AWS Lambda with KMS Integration

This directory contains the implementation of a LiteLLM proxy server that runs on AWS Lambda using the Lambda Web Adapter. The proxy provides a unified OpenAI-compatible API interface for various AI models with AWS KMS integration for secure API key management.

## Overview

The LiteLLM proxy server is deployed as a Docker container on AWS Lambda with the following features:

- **Lambda Web Adapter**: Enables FastAPI application to run on Lambda
- **Function URL with IAM Authentication**: Provides secure internal service access
- **Multi-Provider Support**: Supports AWS Bedrock, OpenAI, Azure OpenAI, Google Vertex AI, Anthropic, Cohere, and more
- **OpenAI-Compatible API**: Standard chat completions endpoint for easy integration
- **Fully Dynamic Configuration**: No hardcoded models - everything configured through CDK
- **KMS Integration**: Secure API key management using AWS KMS and Secrets Manager
- **Zero Hardcoding**: Models and providers defined entirely in cdk.json

## Files

- `Dockerfile`: Container configuration with Lambda Web Adapter
- `startup.py`: Python startup script that launches the proxy
- `config_loader.py`: Dynamic configuration loader that reads from environment and Secrets Manager
- `README.md`: This documentation file
- `HOW_TO_CONFIGURE_MODELS.md`: Detailed guide on configuring models
- `CONFIGURATION.md`: Configuration format reference

## How It Works

1. **Configuration**: Models and providers are defined in `cdk.json`
2. **Deployment**: CDK passes configuration via `LITELLM_CONFIG` environment variable
3. **Startup**: `config_loader.py` reads the configuration and fetches API keys from Secrets Manager
4. **Runtime**: LiteLLM proxy serves requests using the dynamic configuration

## Environment Variables

The following environment variables are set by the CDK deployment:

- `AWS_LWA_PORT=8000`: Port for Lambda Web Adapter
- `AWS_LWA_READINESS_CHECK_PATH=/health`: Health check endpoint
- `AWS_LWA_INVOKE_MODE=RESPONSE_STREAM`: Enable streaming responses
- `BEDROCK_REGION`: AWS region for Bedrock access (default: us-east-1)
- `LITELLM_LOG=INFO`: Logging level
- `KMS_KEY_ARN`: ARN of the KMS key for decrypting secrets
- `SECRETS_PREFIX`: Prefix for secrets in Secrets Manager (default: litellm/)
- `LITELLM_CONFIG`: JSON configuration containing providers and models (REQUIRED)

## Model Configuration

All models are configured through the `litellm` section in your `cdk.json`. See [HOW_TO_CONFIGURE_MODELS.md](./HOW_TO_CONFIGURE_MODELS.md) for detailed examples.

### Quick Example

In your `cdk.json`:

```json
{
  "context": {
    "litellmProxyEnabled": true,
    "litellm": {
      "enabled": true,
      "providers": {
        "bedrock": {
          "enabled": true,
          "region": "us-east-1",
          "models": [
            {
              "name": "claude-3-5-sonnet",
              "model": "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
            }
          ]
        },
        "openai": {
          "enabled": true,
          "useSecretKey": true,
          "models": [
            {
              "name": "gpt-4",
              "model": "gpt-4"
            }
          ]
        }
      }
    }
  }
}
```

## API Usage

The proxy provides an OpenAI-compatible API:

```bash
# Get the endpoint URL from CloudFormation outputs
LITELLM_ENDPOINT="https://your-function-url.lambda-url.region.on.aws"

# Create AWS signature for IAM authentication
curl "$LITELLM_ENDPOINT/chat/completions" \
  --aws-sigv4 "aws:amz:region:lambda" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## KMS Integration

The proxy always uses KMS integration for secure API key management:

1. **API keys are stored encrypted** in AWS Secrets Manager
2. **Keys are decrypted at runtime** using KMS
3. **No keys in environment variables** or configuration files
4. **Automatic key rotation** support

### Storing API Keys

After deployment, store your API keys:

```bash
# Store master key for LiteLLM admin access
aws secretsmanager put-secret-value \
  --secret-id litellm/master-key \
  --secret-string "sk-litellm-your-secure-master-key"

# Store provider API keys
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-proj-your-openai-api-key"
```

## Benefits of Dynamic Configuration

- **No Hardcoded Keys**: API keys are never stored in code or configuration files
- **No Hardcoded Models**: Add new models without changing code
- **Automatic Rotation**: Support for automatic key rotation every 90 days
- **Audit Trail**: CloudTrail logs all key access for compliance
- **Fine-Grained Access**: IAM policies control who can access which keys
- **Zero Downtime Updates**: Change API keys or add models without redeploying

## Deployment

### Enable in CDK Configuration

Add the following to your CDK context:

```json
{
  "litellmProxyEnabled": true,
  "litellm": {
    "enabled": true,
    "providers": {
      // Your provider configurations
    }
  }
}
```

### Deploy

```bash
cd packages/cdk
npm run cdk deploy
```

### Verify Deployment

Check the CloudFormation outputs for:
- `LitellmProxyEnabled`: Should be `true`
- `LitellmProxyEndpoint`: The Function URL endpoint

Test the health endpoint:
```bash
curl https://your-function-url.lambda-url.region.on.aws/health
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Client    │────▶│   Lambda    │────▶│   LiteLLM    │
│             │     │  Function   │     │    Proxy     │
└─────────────┘     └─────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                    ┌─────────────┐     ┌──────────────┐
                    │   Secrets   │     │   Bedrock/   │
                    │   Manager   │     │   OpenAI/    │
                    └─────────────┘     │   Claude     │
                            │           └──────────────┘
                            ▼
                    ┌─────────────┐
                    │     KMS     │
                    └─────────────┘
```

## Security Best Practices

1. **Function URL with IAM Auth**: Ensures only authenticated AWS principals can access
2. **Encrypted Secrets**: All API keys stored encrypted in Secrets Manager
3. **Least Privilege IAM**: Lambda role has minimal required permissions
4. **No Public Access**: Function URL requires AWS signature authentication
5. **Audit Logging**: All key access logged via CloudTrail

## Troubleshooting

1. **Configuration Errors**: Check CloudWatch logs for the Lambda function
2. **Missing API Keys**: Ensure secrets are created in Secrets Manager
3. **IAM Permissions**: Verify Lambda role has access to Secrets Manager and KMS
4. **Model Not Found**: Check that the model is configured in cdk.json

## Cost Considerations

- **Lambda Costs**: Based on requests and duration
- **KMS Costs**: ~$1/month for the KMS key
- **Secrets Manager**: $0.40/month per secret
- **Model Costs**: Vary by provider (Bedrock, OpenAI, etc.)

## Further Reading

- [How to Configure Models](./HOW_TO_CONFIGURE_MODELS.md)
- [Configuration Format Reference](./CONFIGURATION.md)
- [LiteLLM Documentation](https://docs.litellm.ai/)
- [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)