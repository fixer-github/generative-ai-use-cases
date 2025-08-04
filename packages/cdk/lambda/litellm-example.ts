import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getLiteLLMKmsClient } from './utils/litellmKmsClient';

/**
 * Example Lambda function demonstrating LiteLLM with KMS integration
 * This function handles chat completions using multiple LLM providers
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Parse the request body
    const body = JSON.parse(event.body || '{}');
    const { messages, model, temperature, max_tokens } = body;

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Messages array is required',
        }),
      };
    }

    // Initialize LiteLLM KMS client
    console.log('Initializing LiteLLM KMS client...');
    const litellmClient = await getLiteLLMKmsClient();

    // Get configuration and available models
    const config = await litellmClient.getConfiguration();
    const modelConfigs = await litellmClient.buildModelConfig();

    console.log('Available providers:', Object.keys(config.providers));
    console.log('Model configurations:', modelConfigs.length);

    // Prepare the LiteLLM request
    const litellmRequest = {
      model: model || config.defaultProvider + '/gpt-4',
      messages,
      temperature: temperature || 0.7,
      max_tokens: max_tokens || 1000,
    };

    // Example: Get specific provider API key if needed
    if (model?.startsWith('openai/')) {
      const openaiKey = await litellmClient.getProviderApiKey('openai');
      if (!openaiKey) {
        throw new Error('OpenAI API key not found');
      }
      // In a real implementation, you would pass this to LiteLLM
    }

    // Here you would typically call LiteLLM proxy or SDK
    // For this example, we'll return a mock response
    const mockResponse = {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: litellmRequest.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `This is a mock response from the LiteLLM KMS integration example. 
                     In a real implementation, this would call the LiteLLM proxy with your decrypted API keys.
                     
                     Available providers: ${Object.keys(config.providers).filter(p => config.providers[p].enabled).join(', ')}
                     Default provider: ${config.defaultProvider}
                     Routing strategy: ${config.routing?.strategy || 'round-robin'}`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 100,
        total_tokens: 150,
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mockResponse),
    };
  } catch (error) {
    console.error('Error processing request:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'internal_error',
        },
      }),
    };
  }
};

/**
 * Example: Virtual key creation handler
 */
export const createVirtualKeyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, expiresIn, models, metadata } = body;

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'userId is required' }),
      };
    }

    const litellmClient = await getLiteLLMKmsClient();
    const config = await litellmClient.getConfiguration();

    // Generate virtual key
    const virtualKey = {
      key: `${config.virtualKeys.prefix}${userId}_${Date.now()}`,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + (expiresIn || config.virtualKeys.defaultExpiry) * 1000
      ).toISOString(),
      models: models || ['*'],
      metadata: metadata || {},
    };

    // Encrypt the virtual key data
    const encryptedKey = await litellmClient.encryptData(
      JSON.stringify(virtualKey)
    );

    // Store encrypted key (in real implementation, store in DynamoDB/Secrets Manager)
    console.log('Encrypted virtual key:', encryptedKey.substring(0, 50) + '...');

    // In a real implementation, you would store this in DynamoDB or Secrets Manager
    console.log('Created virtual key:', virtualKey.key);

    return {
      statusCode: 201,
      body: JSON.stringify({
        virtualKey: virtualKey.key,
        expiresAt: virtualKey.expiresAt,
        models: virtualKey.models,
      }),
    };
  } catch (error) {
    console.error('Error creating virtual key:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to create virtual key',
      }),
    };
  }
};

/**
 * Example: Health check handler
 */
export const healthCheckHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const litellmClient = await getLiteLLMKmsClient();
    const config = await litellmClient.getConfiguration();

    const enabledProviders = Object.entries(config.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([name]) => name);

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        providers: {
          enabled: enabledProviders,
          total: Object.keys(config.providers).length,
        },
        kms: {
          configured: true,
          caching: config.enableCaching,
        },
        virtualKeys: {
          enabled: config.virtualKeys.enabled,
        },
      }),
    };
  } catch (error) {
    console.error('Health check failed:', error);

    return {
      statusCode: 503,
      body: JSON.stringify({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Health check failed',
      }),
    };
  }
};