import { getLiteLLMKmsClient, LiteLLMConfig, LiteLLMKmsClient } from './litellmKmsClient';

export interface LiteLLMProxyConfig {
  general_settings: {
    key_management_system: string;
    key_management_settings: {
      hosted_keys: string[];
      access_mode?: string;
      store_virtual_keys?: boolean;
      prefix_for_stored_virtual_keys?: string;
    };
  };
  model_list: Array<{
    model_name: string;
    litellm_params: {
      model: string;
      api_key?: string;
      api_base?: string;
      api_version?: string;
      aws_region_name?: string;
    };
  }>;
  router_settings?: {
    routing_strategy?: string;
    enable_fallbacks?: boolean;
    fallback_models?: string[];
    model_group_config?: Record<string, {
      rpm?: number;
      tpm?: number;
    }>;
  };
  litellm_settings?: {
    cache?: boolean;
    cache_backend?: string;
    cache_ttl?: number;
    request_timeout?: number;
    max_retries?: number;
    retry_after?: number;
  };
  virtual_key_settings?: {
    enable_virtual_keys?: boolean;
    default_key_expiry?: number;
    max_keys_per_user?: number;
    key_pattern?: string;
  };
}

/**
 * Generate LiteLLM proxy configuration dynamically from CDK context and secrets
 */
export class LiteLLMConfigGenerator {
  /**
   * Generate complete LiteLLM proxy configuration
   */
  static async generateProxyConfig(): Promise<LiteLLMProxyConfig> {
    const client = await getLiteLLMKmsClient();
    const config = await client.getConfiguration();

    // Build model list from configuration
    const modelList = await this.buildModelList(client, config);

    // Generate proxy configuration
    const proxyConfig: LiteLLMProxyConfig = {
      general_settings: {
        key_management_system: 'aws_kms',
        key_management_settings: {
          hosted_keys: ['LITELLM_MASTER_KEY'],
          access_mode: 'read_and_write',
          store_virtual_keys: config.virtualKeys?.enabled || false,
          prefix_for_stored_virtual_keys: config.virtualKeys?.prefix || 'litellm_vk_',
        },
      },
      model_list: modelList,
      router_settings: {
        routing_strategy: config.routing?.strategy || 'least-cost',
        enable_fallbacks: config.routing?.enableFallbacks ?? true,
        fallback_models: this.buildFallbackModels(config),
        model_group_config: this.buildModelGroupConfig(config),
      },
      litellm_settings: {
        cache: config.enableCaching ?? true,
        cache_backend: 'redis',
        cache_ttl: 3600,
        request_timeout: 600,
        max_retries: 3,
        retry_after: 5,
      },
      virtual_key_settings: {
        enable_virtual_keys: config.virtualKeys?.enabled || false,
        default_key_expiry: config.virtualKeys?.defaultExpiry || 2592000,
        max_keys_per_user: config.virtualKeys?.maxKeysPerUser || 10,
        key_pattern: '{prefix}{user_id}_{timestamp}',
      },
    };

    return proxyConfig;
  }

  /**
   * Build model list from providers configuration
   */
  private static async buildModelList(
    client: LiteLLMKmsClient,
    config: LiteLLMConfig
  ): Promise<LiteLLMProxyConfig['model_list']> {
    const models: LiteLLMProxyConfig['model_list'] = [];

    // OpenAI models
    if (config.providers.openai?.enabled) {
      const apiKey = await client.getProviderApiKey('openai');
      if (apiKey) {
        models.push(
          {
            model_name: 'gpt-4',
            litellm_params: {
              model: 'openai/gpt-4',
              api_key: apiKey,
            },
          },
          {
            model_name: 'gpt-3.5-turbo',
            litellm_params: {
              model: 'openai/gpt-3.5-turbo',
              api_key: apiKey,
            },
          }
        );
      }
    }

    // Anthropic models
    if (config.providers.anthropic?.enabled) {
      const apiKey = await client.getProviderApiKey('anthropic');
      if (apiKey) {
        models.push(
          {
            model_name: 'claude-3-opus',
            litellm_params: {
              model: 'anthropic/claude-3-opus-20240229',
              api_key: apiKey,
            },
          },
          {
            model_name: 'claude-3-sonnet',
            litellm_params: {
              model: 'anthropic/claude-3-sonnet-20240229',
              api_key: apiKey,
            },
          }
        );
      }
    }

    // AWS Bedrock models (using IAM role)
    if (config.providers.bedrock?.enabled && config.providers.bedrock.useIAMRole) {
      models.push(
        {
          model_name: 'bedrock-claude-3',
          litellm_params: {
            model: 'bedrock/anthropic.claude-3-sonnet-20240229-v1:0',
            aws_region_name: process.env.AWS_REGION || 'us-east-1',
          },
        },
        {
          model_name: 'bedrock-claude-3-opus',
          litellm_params: {
            model: 'bedrock/anthropic.claude-3-opus-20240229-v1:0',
            aws_region_name: process.env.AWS_REGION || 'us-east-1',
          },
        }
      );
    }

    // Azure OpenAI models
    if (config.providers.azure?.enabled) {
      const apiKey = await client.getProviderApiKey('azure');
      if (apiKey && config.providers.azure.endpoint) {
        models.push({
          model_name: 'azure-gpt-4',
          litellm_params: {
            model: 'azure/gpt-4',
            api_key: apiKey,
            api_base: config.providers.azure.endpoint,
            api_version: '2024-02-01',
          },
        });
      }
    }

    return models;
  }

  /**
   * Build fallback models list
   */
  private static buildFallbackModels(config: LiteLLMConfig): string[] {
    const fallbacks: string[] = [];

    if (config.providers.openai?.enabled) {
      fallbacks.push('gpt-4');
    }
    if (config.providers.anthropic?.enabled) {
      fallbacks.push('claude-3-opus');
    }
    if (config.providers.bedrock?.enabled) {
      fallbacks.push('bedrock-claude-3');
    }

    return fallbacks;
  }

  /**
   * Build model group configuration for rate limiting
   */
  private static buildModelGroupConfig(
    config: LiteLLMConfig
  ): Record<string, { rpm: number; tpm: number }> {
    const modelConfig: Record<string, { rpm: number; tpm: number }> = {};

    if (config.providers.openai?.enabled) {
      modelConfig['gpt-4'] = {
        rpm: 10000,
        tpm: 1000000,
      };
      modelConfig['gpt-3.5-turbo'] = {
        rpm: 20000,
        tpm: 2000000,
      };
    }

    if (config.providers.anthropic?.enabled) {
      modelConfig['claude-3-opus'] = {
        rpm: 5000,
        tpm: 500000,
      };
      modelConfig['claude-3-sonnet'] = {
        rpm: 10000,
        tpm: 1000000,
      };
    }

    return modelConfig;
  }

  /**
   * Generate YAML configuration string
   */
  static async generateYamlConfig(): Promise<string> {
    const config = await this.generateProxyConfig();
    
    // Convert to YAML format (simplified version)
    // In production, use a proper YAML library like js-yaml
    return this.toYaml(config);
  }

  /**
   * Simple object to YAML converter
   */
  private static toYaml(obj: Record<string, unknown> | unknown, indent = 0): string {
    let yaml = '';
    const spaces = ' '.repeat(indent);

    if (!obj || typeof obj !== 'object' || obj instanceof Date) {
      return `${spaces}${obj}\n`;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`;
        value.forEach((item) => {
          if (typeof item === 'object') {
            yaml += `${spaces}  -\n`;
            yaml += this.toYaml(item, indent + 4);
          } else {
            yaml += `${spaces}  - ${item}\n`;
          }
        });
      } else if (typeof value === 'object') {
        yaml += `${spaces}${key}:\n`;
        yaml += this.toYaml(value, indent + 2);
      } else {
        yaml += `${spaces}${key}: ${value}\n`;
      }
    }

    return yaml;
  }
}
