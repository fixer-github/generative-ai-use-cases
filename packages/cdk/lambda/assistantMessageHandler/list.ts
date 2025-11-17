import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ListAssistantMessagesResponse } from 'generative-ai-use-cases';
import { listAssistantMessages } from '../repository';
import { getAssistant } from '../repository/assistant';
import {
  notFound404Response,
  forbidden403Response,
  badRequest400Response,
  ok200Response,
} from '../utils/apiResponse';
import { canAccessAssistant } from '../utils/assistantAccessControl';
import { addAssistantIdToMessage } from './util';

/**
 * Handle GET /{assistantId}/messages - List messages
 */
export async function handleListMessages(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // Get assistant and verify access
  const assistant = await getAssistant(assistantId, event);

  if (!assistant) {
    return notFound404Response({ message: 'Assistant not found' });
  }

  // Check access: owner OR (public AND same tenant)
  if (!canAccessAssistant(assistant, userId, event)) {
    return forbidden403Response({
      message: 'Access denied to this assistant',
      code: 'ASSISTANT_ACCESS_DENIED',
    });
  }

  const chatId = event.queryStringParameters?.chatId;

  // TODO: 将来的には統合チャット履歴のメッセージ取得に置き換える予定
  if (!chatId) {
    return badRequest400Response({ message: 'Missing chatId parameter' });
  }

  const exclusiveStartKey = event.queryStringParameters?.exclusiveStartKey;
  const limit = event.queryStringParameters?.limit
    ? parseInt(event.queryStringParameters.limit)
    : undefined;

  const result = await listAssistantMessages(
    userId,
    chatId,
    event,
    exclusiveStartKey,
    limit
  );

  // Add assistantId to all messages for API response
  const sanitizedResult: ListAssistantMessagesResponse = {
    ...result,
    messages: result.messages.map((msg) =>
      addAssistantIdToMessage(msg, assistantId)
    ),
  };

  return ok200Response(sanitizedResult);
}
