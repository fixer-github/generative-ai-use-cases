import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ModelConfiguration } from 'generative-ai-use-cases';

// Get models configuration from environment variables
const modelRegion = process.env.MODEL_REGION || '';
const modelConfigs: ModelConfiguration[] = JSON.parse(
  process.env.MODEL_IDS || '[]'
);
const imageModelConfigs: ModelConfiguration[] = JSON.parse(
  process.env.IMAGE_MODEL_IDS || '[]'
);
const videoModelConfigs: ModelConfiguration[] = JSON.parse(
  process.env.VIDEO_MODEL_IDS || '[]'
);
const speechToSpeechModelConfigs: ModelConfiguration[] = JSON.parse(
  process.env.SPEECH_TO_SPEECH_MODEL_IDS || '[]'
);
const endpointNames: string[] = JSON.parse(
  process.env.ENDPOINT_NAMES || '[]'
);
const agentNames: string[] = JSON.parse(process.env.AGENT_NAMES || '[]');
const flows = JSON.parse(process.env.FLOWS || '[]');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Fetching models configuration');

    const response = {
      modelRegion,
      modelIds: modelConfigs,
      imageModelIds: imageModelConfigs,
      videoModelIds: videoModelConfigs,
      speechToSpeechModelIds: speechToSpeechModelConfigs,
      endpointNames,
      agentNames,
      flows,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error fetching models:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Failed to fetch models configuration',
      }),
    };
  }
};
