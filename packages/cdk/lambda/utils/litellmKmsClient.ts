import { KMSClient, DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

interface LiteLLMConfig {
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
  enableCaching: boolean;
  virtualKeys: {
    enabled: boolean;
    prefix: string;
  };
}

interface ProviderConfig {
  enabled: boolean;
  modelPrefix: string;
  endpoint?: string;
  useIAMRole?: boolean;
  secretArn?: string;
}

interface DecryptedSecrets {
  [provider: string]: string;
}

class LiteLLMKmsClient {
  private kmsClient: KMSClient;
  private secretsClient: SecretsManagerClient;
  private cachedConfig: LiteLLMConfig | null = null;
  private cachedSecrets: DecryptedSecrets = {};
  private cacheExpiry: number = 0;
  private readonly cacheDuration = 3600000; // 1 hour in milliseconds

  constructor() {
    const region =
      process.env.AWS_REGION_NAME || process.env.AWS_REGION || 'us-east-1';
    this.kmsClient = new KMSClient({ region });
    this.secretsClient = new SecretsManagerClient({ region });
  }

  /**
   * Initialize LiteLLM with KMS-encrypted configuration
   */
  async initialize(): Promise<void> {
    try {
      // Load configuration from Secrets Manager
      await this.loadConfiguration();

      // Decrypt and cache API keys for enabled providers
      await this.decryptProviderSecrets();

      console.log('LiteLLM KMS client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize LiteLLM KMS client:', error);
      throw error;
    }
  }

  /**
   * Load configuration from AWS Secrets Manager
   */
  private async loadConfiguration(): Promise<void> {
    const configSecretArn = process.env.LITELLM_CONFIG_SECRET_ARN;
    if (!configSecretArn) {
      throw new Error('LITELLM_CONFIG_SECRET_ARN environment variable not set');
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: configSecretArn,
      });

      const response = await this.secretsClient.send(command);
      if (!response.SecretString) {
        throw new Error('Configuration secret is empty');
      }

      this.cachedConfig = JSON.parse(response.SecretString) as LiteLLMConfig;
      this.cacheExpiry = Date.now() + this.cacheDuration;
    } catch (error) {
      console.error('Failed to load LiteLLM configuration:', error);
      throw error;
    }
  }

  /**
   * Decrypt provider API keys from Secrets Manager
   */
  private async decryptProviderSecrets(): Promise<void> {
    if (!this.cachedConfig) {
      throw new Error('Configuration not loaded');
    }

    const decryptPromises: Promise<void>[] = [];

    for (const [providerName, providerConfig] of Object.entries(
      this.cachedConfig.providers
    )) {
      if (
        providerConfig.enabled &&
        providerConfig.secretArn &&
        !providerConfig.useIAMRole
      ) {
        decryptPromises.push(
          this.decryptProviderSecret(providerName, providerConfig)
        );
      }
    }

    await Promise.all(decryptPromises);
  }

  /**
   * Decrypt a single provider's API key
   */
  private async decryptProviderSecret(
    providerName: string,
    providerConfig: ProviderConfig
  ): Promise<void> {
    try {
      const command = new GetSecretValueCommand({
        SecretId: providerConfig.secretArn,
      });

      const response = await this.secretsClient.send(command);
      if (!response.SecretString) {
        throw new Error(`API key for ${providerName} is empty`);
      }

      // Cache the decrypted secret
      this.cachedSecrets[providerName] = response.SecretString;
    } catch (error) {
      console.error(`Failed to decrypt ${providerName} API key:`, error);
      throw error;
    }
  }

  /**
   * Get decrypted API key for a specific provider
   */
  async getProviderApiKey(providerName: string): Promise<string | undefined> {
    // Check cache validity
    if (Date.now() > this.cacheExpiry) {
      await this.initialize();
    }

    return this.cachedSecrets[providerName];
  }

  /**
   * Get LiteLLM configuration
   */
  async getConfiguration(): Promise<LiteLLMConfig> {
    // Check cache validity
    if (!this.cachedConfig || Date.now() > this.cacheExpiry) {
      await this.loadConfiguration();
    }

    return this.cachedConfig!;
  }

  /**
   * Encrypt data using KMS (for virtual key creation)
   */
  async encryptData(plaintext: string): Promise<string> {
    const kmsKeyId = process.env.KMS_KEY_ID;
    if (!kmsKeyId) {
      throw new Error('KMS_KEY_ID environment variable not set');
    }

    try {
      const command = new EncryptCommand({
        KeyId: kmsKeyId,
        Plaintext: Buffer.from(plaintext),
      });

      const response = await this.kmsClient.send(command);
      if (!response.CiphertextBlob) {
        throw new Error('Encryption failed');
      }

      return Buffer.from(response.CiphertextBlob).toString('base64');
    } catch (error) {
      console.error('Failed to encrypt data:', error);
      throw error;
    }
  }

  /**
   * Decrypt data using KMS
   */
  async decryptData(ciphertext: string): Promise<string> {
    try {
      const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      });

      const response = await this.kmsClient.send(command);
      if (!response.Plaintext) {
        throw new Error('Decryption failed');
      }

      return Buffer.from(response.Plaintext).toString('utf-8');
    } catch (error) {
      console.error('Failed to decrypt data:', error);
      throw error;
    }
  }

  /**
   * Build LiteLLM model configuration with decrypted API keys
   */
  async buildModelConfig(): Promise<
    Array<{
      model_name: string;
      litellm_params: {
        model: string;
        api_key?: string;
        api_base?: string;
      };
    }>
  > {
    const config = await this.getConfiguration();
    const models: Array<{
      model_name: string;
      litellm_params: {
        model: string;
        api_key?: string;
        api_base?: string;
      };
    }> = [];

    for (const [providerName, providerConfig] of Object.entries(
      config.providers
    )) {
      if (providerConfig.enabled) {
        const baseConfig = {
          model_name: `${providerConfig.modelPrefix}/*`,
          litellm_params: {
            model: `${providerName}/*`,
          },
        };

        // Add API key if not using IAM role
        if (!providerConfig.useIAMRole) {
          const apiKey = await this.getProviderApiKey(providerName);
          if (apiKey) {
            baseConfig.litellm_params.api_key = apiKey;
          }
        }

        // Add endpoint if specified
        if (providerConfig.endpoint) {
          baseConfig.litellm_params.api_base = providerConfig.endpoint;
        }

        models.push(baseConfig);
      }
    }

    return models;
  }

  /**
   * Clear cached secrets (useful for rotation scenarios)
   */
  clearCache(): void {
    this.cachedConfig = null;
    this.cachedSecrets = {};
    this.cacheExpiry = 0;
  }
}

// Export singleton instance
let clientInstance: LiteLLMKmsClient | null = null;

export const getLiteLLMKmsClient = async (): Promise<LiteLLMKmsClient> => {
  if (!clientInstance) {
    clientInstance = new LiteLLMKmsClient();
    await clientInstance.initialize();
  }
  return clientInstance;
};

export { LiteLLMKmsClient, LiteLLMConfig, ProviderConfig };
