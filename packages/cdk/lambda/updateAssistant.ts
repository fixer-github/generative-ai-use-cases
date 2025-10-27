import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { updateAssistant } from './repository/assistant';
import { UpdateAssistantRequest } from 'generative-ai-use-cases';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const assistantId = event.pathParameters?.assistantId;

    if (!assistantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Missing assistantId' }),
      };
    }

    const body: UpdateAssistantRequest = JSON.parse(event.body || '{}');

    try {
      const assistant = await updateAssistant(
        assistantId,
        userId,
        body,
        event
      );

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(assistant),
      };
    } catch (error: any) {
      if (error.message === 'Assistant not found') {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Assistant not found' }),
        };
      }
      if (error.message === 'Unauthorized') {
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Forbidden' }),
        };
      }
      throw error;
    }
  } catch (error) {
    console.error('Error updating assistant:', error);
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
