import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';
import { ableToAccessThisBot } from './utils/botUtils';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const botId = event.pathParameters?.botId;

    if (!botId) {
      throw new Error('botId is null!');
    }

    const existingBot = await repository.getBot(botId, event);

    if (!existingBot || !ableToAccessThisBot(userId, existingBot)) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Bot not found' }),
      };
    }

    await repository.deleteBot(botId, event);

    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: '{}',
    };
  } catch (error) {
    console.error(error);

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
