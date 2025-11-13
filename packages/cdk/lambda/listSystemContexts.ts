import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listSystemContexts } from './repository';
import { SystemContext } from 'generative-ai-use-cases';
import { getUsername } from './utils/tenantUtils';
import {
  ok200Response,
  internalServerError500Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const systemContextItems: SystemContext[] = await listSystemContexts(
      userId,
      event
    );

    return ok200Response(systemContextItems);
  } catch (error) {
    console.log(error);
    return internalServerError500Response('Internal Server Error');
  }
};
