import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ModelData } from 'generative-ai-use-cases';

const httpGetAsync = async <TResponse>(
  url: string,
  headers: Record<string, string> = {}
): Promise<TResponse> => {
  const res = await fetch(url, {
    method: 'GET',
    headers: headers,
  });

  if (res.ok) {
    const resText = await res.text();
    const response: TResponse = JSON.parse(resText);

    return response;
  }

  throw new Error('Failed to fetch');
};

const getAvailableModelsFromBedrock = async () => {
  const models = [
    'us.anthropic.claude-sonnet-4-20250514-v1:0',
    'us.anthropic.claude-opus-4-20250514-v1:0',
    'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    'us.amazon.nova-premier-v1:0',
    'us.amazon.nova-pro-v1:0',
    'us.amazon.nova-lite-v1:0',
    'us.amazon.nova-micro-v1:0',
    'us.deepseek.r1-v1:0',
  ];

  const response: ModelData[] = models.map((model) => ({
    modelId: model,
    type: 'bedrock',
    displayName: model,
    features: {
      text: true,
      doc: true,
      image: true,
      video: false,
    },
  }));

  return response;
};

const getAvailableModelsFromLiteLlm = async () => {
  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];

  const response: ModelData[] = models.map((model) => ({
    modelId: model,
    type: 'litellm',
    displayName: model,
    features: {
      text: true,
      doc: true,
      image: true,
      video: false,
    },
  }));

  return response;
};

const getAvailableModelsFromLangChain = async () => {
  const models = [
    'openai:gpt-4o',
    'openai:gpt-4o-mini',
    'openai:o3',
    'openai:gpt-4.1',
    'openai:gpt-5',
  ];

  const response: ModelData[] = models.map((model) => ({
    modelId: model,
    type: 'langchain',
    displayName: model,
    features: {
      text: true,
      doc: true,
      image: true,
      video: false,
    },
  }));

  return response;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const promises = [
      getAvailableModelsFromBedrock(),
      getAvailableModelsFromLiteLlm(),
      getAvailableModelsFromLangChain(),
    ];

    const result = await Promise.all(promises);

    const availableModels = result.flat();

    const response = {
      models: availableModels,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error(error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
