import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BotEntity, BotUpsertRequest } from 'generative-ai-use-cases';
import * as repository from './repository';
import { ableToAccessThisBot } from './utils/botUtils';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const request: BotUpsertRequest = JSON.parse(event.body!);
    const botId = request.id;
    const existingBot = await repository.getBot(botId, event);
    const createdDate = new Date(0).toISOString();

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

    const item: BotEntity = {
      id: botId,
      createdDate: createdDate,
      userId: userId,
      title: request.title,
      description: request.description,
      promptTemplate: request.promptTemplate,
      publicInOrg: request.publicInOrg,
      inputExamples: request.inputExamples,
      useFixedModel: request.useFixedModel,
      modelId: request.modelId,
      fileAttachEnabled: request.fileAttachEnabled,
      knouledgeFiles: existingBot.knouledgeFiles,
    };

    await repository.upsertBot(item, event);

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
