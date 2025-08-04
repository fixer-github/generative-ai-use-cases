import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LiteLLMConfigGenerator } from './utils/litellmConfigGenerator';

/**
 * Lambda function to generate LiteLLM proxy configuration dynamically
 * This avoids storing configuration in static files and prevents unnecessary redeployments
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Generating LiteLLM configuration dynamically');

  try {
    const format = event.queryStringParameters?.format || 'json';

    if (format === 'yaml') {
      // Generate YAML configuration
      const yamlConfig = await LiteLLMConfigGenerator.generateYamlConfig();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/yaml',
        },
        body: yamlConfig,
      };
    } else {
      // Generate JSON configuration
      const jsonConfig = await LiteLLMConfigGenerator.generateProxyConfig();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonConfig, null, 2),
      };
    }
  } catch (error) {
    console.error('Error generating LiteLLM configuration:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Failed to generate configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};