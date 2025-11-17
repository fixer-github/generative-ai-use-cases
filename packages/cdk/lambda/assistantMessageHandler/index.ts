import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  badRequest400Response,
  internalServerError500Response,
  methodNotAllowed405Response,
} from '../utils/apiResponse';
import { handleCreateMessage } from './create';
import { handleListMessages } from './list';
import * as console from 'node:console';

/**
 * Consolidated handler for assistant message operations
 * Routes based on HTTP method:
 * - POST /{assistantId}/messages → create message (with RAG)
 * - GET /{assistantId}/messages → list messages
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const assistantId = event.pathParameters?.assistantId;
    const method = event.httpMethod;

    if (!assistantId) {
      return badRequest400Response({ message: 'Missing assistantId' });
    }

    // Route based on HTTP method
    switch (method) {
      case 'POST':
        return await handleCreateMessage(userId, assistantId, event);

      case 'GET':
        return await handleListMessages(userId, assistantId, event);

      default:
        return methodNotAllowed405Response({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in assistant message handler:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
