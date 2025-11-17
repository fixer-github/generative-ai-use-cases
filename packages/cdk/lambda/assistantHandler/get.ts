import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAssistant } from '../repository/assistant';
import {
  notFound404Response,
  forbidden403Response,
  ok200Response,
} from '../utils/apiResponse';
import { canAccessAssistant } from '../utils/assistantAccessControl';
import { stripAssistantPrefix } from './util';

/**
 * Handle GET /{assistantId} - Get assistant
 */
export async function handleGet(
  userId: string,
  assistantId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
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

  return ok200Response(stripAssistantPrefix(assistant));
}
