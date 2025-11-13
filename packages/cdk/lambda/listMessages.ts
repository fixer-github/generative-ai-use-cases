import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findChatById, listMessages } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
  ok200Response,
  forbidden403Response,
  internalServerError500Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const chatId = event.pathParameters!.chatId!;
    const chat = await findChatById(userId, chatId, event);

    if (chat === null) {
      return forbidden403Response('Forbidden');
    }

    const messages = await listMessages(chatId, event);

    return ok200Response({
      messages,
    });
  } catch (error) {
    console.log(error);
    return internalServerError500Response('Internal Server Error');
  }
};
