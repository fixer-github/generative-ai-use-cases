import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findChatById, listMessages } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
  forbidden403Response,
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';
import { logger } from './utils/logger';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const chatId = event.pathParameters!.chatId!;
    const chat = await findChatById(userId, chatId, event);

    if (chat === null) {
      logger.warn('Chat not found', { userId, chatId });
      return forbidden403Response({
        message: 'Chat not found or access denied',
        code: 'CHAT_NOT_FOUND',
      });
    }

    const messages = await listMessages(chatId, event);

    return ok200Response({
      messages,
    });
  } catch (error) {
    logger.error(
      'Error listing messages',
      { userId, chatId },
      error instanceof Error ? error : undefined
    );
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
