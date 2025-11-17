import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  badRequest400Response,
  internalServerError500Response,
  methodNotAllowed405Response,
} from '../utils/apiResponse';
import { handleCreate } from './create';
import { handleDelete } from './delete';
import { handleGet } from './get';
import { handleList } from './list';
import { handleUpdate } from './update';
import * as console from 'node:console';

/**
 * Consolidated handler for all assistant CRUD operations
 * Routes based on HTTP method and path:
 * - POST / → create assistant
 * - GET / → list assistants
 * - GET /{assistantId} → get assistant
 * - PUT /{assistantId} → update assistant
 * - DELETE /{assistantId} → delete assistant
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const method = event.httpMethod;
    const assistantId = event.pathParameters?.assistantId;

    // Route based on HTTP method and path
    switch (method) {
      case 'POST':
        return await handleCreate(userId, event);

      case 'GET':
        if (assistantId) {
          return await handleGet(userId, assistantId, event);
        } else {
          return await handleList(userId, event);
        }

      case 'PUT':
        if (!assistantId) {
          return badRequest400Response({ message: 'Missing assistantId' });
        }
        return await handleUpdate(userId, assistantId, event);

      case 'DELETE':
        if (!assistantId) {
          return badRequest400Response({ message: 'Missing assistantId' });
        }
        return await handleDelete(userId, assistantId, event);

      default:
        return methodNotAllowed405Response({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in assistant handler:', error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
