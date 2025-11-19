import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createChat } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);

    // リクエストボディからchatIdを取得（オプショナル）
    const body = event.body ? JSON.parse(event.body) : {};
    const chatId = body.chatId;

    const chat = await createChat(userId, event, chatId);

    return ok200Response({
      chat,
    });
  } catch (error) {
    console.log(error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
