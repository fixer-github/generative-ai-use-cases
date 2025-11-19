import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { findChatById } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
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
      logger.info('Chat not found', { userId, chatId });
    }

    return ok200Response({
      chat,
    });
  } catch (error) {
    logger.error(
      'Error finding chat by id',
      { userId: getUsername(event), chatId: event.pathParameters?.chatId },
      error instanceof Error ? error : undefined
    );
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
