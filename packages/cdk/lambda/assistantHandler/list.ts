import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ListAssistantsResponse } from 'generative-ai-use-cases';
import { listAssistants } from '../repository/assistant';
import { badRequest400Response, ok200Response } from '../utils/apiResponse';
import { stripAssistantPrefix } from './util';

/**
 * Handle GET / - List assistants
 */
export async function handleList(
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  // Read nextToken parameter (aligned with frontend API contract)
  const nextToken = event.queryStringParameters?.nextToken;

  // Parse and validate limit parameter
  let limit = 100; // default
  if (event.queryStringParameters?.limit) {
    const parsedLimit = parseInt(event.queryStringParameters.limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return badRequest400Response({
        message: 'Invalid limit parameter. Must be between 1 and 100.',
      });
    }
    limit = parsedLimit;
  }

  try {
    const result = await listAssistants(userId, event, nextToken, limit);

    // Strip prefix from all assistants
    // Provide both lastEvaluatedKey (backward compatibility) and nextToken (new standard)
    const sanitizedResult: ListAssistantsResponse = {
      assistants: result.assistants.map(stripAssistantPrefix),
      lastEvaluatedKey: result.lastEvaluatedKey,
      nextToken: result.lastEvaluatedKey,
    };

    return ok200Response(sanitizedResult);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.message === 'Invalid pagination token') {
      return badRequest400Response({
        message: 'Invalid pagination token. Please start from the beginning.',
      });
    }
    throw error;
  }
}
