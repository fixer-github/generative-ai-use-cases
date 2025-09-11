import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';
import { BotGetResponse } from 'generative-ai-use-cases';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const botId = event.pathParameters?.botId;
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    if (!botId) {
      throw new Error('botId is null!');
    }

    const item = await repository.getBot(botId, userId, event);

    console.debug('Item: ', JSON.stringify(item));

    // Return 404 when item is not found or requeted user cannot show item
    if (!item || (item.userId !== userId && item.publicInOrg === false)) {
      console.error('Item not found');

      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Item not found.' }),
      };
    }

    // Create response object
    const response: BotGetResponse = {
      id: item.id,
      userId: item.userId,
      title: item.title,
      description: item.description,
      promptTemplate: item.promptTemplate,
      publicInOrg: item.publicInOrg,
      useFixedModel: item.useFixedModel,
      modelId: item.modelId,
      fileAttachEnabled: item.fileAttachEnabled,
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
    console.log(error);
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
