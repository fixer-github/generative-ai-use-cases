import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createAssistant } from './repository/assistant';
import { CreateAssistantRequest } from 'generative-ai-use-cases';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    const body: CreateAssistantRequest = JSON.parse(event.body || '{}');

    // Basic validation
    if (!body.name || !body.instruction || !body.modelId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Missing required fields: name, instruction, modelId',
        }),
      };
    }

    const assistant = await createAssistant(userId, body, event);

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(assistant),
    };
  } catch (error) {
    console.error('Error creating assistant:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
