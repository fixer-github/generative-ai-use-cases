import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { deleteSystemContext } from './repository';
import { getUsername } from './utils/tenantUtils';
import {
  noContent204Response,
  internalServerError500Response,
} from './utils/apiResponse';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUsername(event);
    const systemContextId = event.pathParameters!.systemContextId!;
    await deleteSystemContext(userId, systemContextId, event);

    return noContent204Response();
  } catch (error) {
    console.log(error);
    return internalServerError500Response('Internal Server Error');
  }
};
