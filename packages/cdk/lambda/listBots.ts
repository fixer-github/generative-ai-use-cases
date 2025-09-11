import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';
import { BotListResponse } from 'generative-ai-use-cases';

const removeBotPrefix = (botId: string) => botId.replace('bot#', '');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    const bots = await repository.listBot(userId, event);

    const res: BotListResponse = {
      items: bots.map((bot) => ({
        id: removeBotPrefix(bot.id),
        title: bot.title,
        description: bot.description,
        publicInOrg: bot.publicInOrg,
        userId: bot.userId,
      })),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(res),
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
