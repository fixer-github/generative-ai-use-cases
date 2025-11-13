import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateTitleRequest } from 'generative-ai-use-cases';
import { findChatById, setChatTitle } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
  ok200Response,
  notFound404Response,
  internalServerError500Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const chatId = event.pathParameters!.chatId!;
    const req: UpdateTitleRequest = JSON.parse(event.body!);

    const chatItem = await findChatById(userId, chatId, event);

    if (!chatItem) {
      return notFound404Response('Chat not found');
    }

    const updatedChat = await setChatTitle(
      chatItem?.id,
      chatItem?.createdDate,
      req.title,
      event
    );

    return ok200Response({ chat: updatedChat });
  } catch (error) {
    console.log(error);
    return internalServerError500Response('Internal Server Error');
  }
};
