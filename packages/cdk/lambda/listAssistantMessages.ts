import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listMessages } from './repository/assistantMessage';
import { getAssistant } from './repository/assistant';

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

    // Verify ownership
    const assistant = await getAssistant(assistantId, event);

    if (!assistant) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Assistant not found' }),
      };
    }

    // Verify ownership (userId is stored with 'user#' prefix)
    if (assistant.userId !== `user#${userId}`) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Forbidden' }),
      };
    }

    const exclusiveStartKey = event.queryStringParameters?.exclusiveStartKey;
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters.limit)
      : undefined;

    const result = await listMessages(
      assistantId,
      event,
      exclusiveStartKey,
      limit
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error listing messages:', error);
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
