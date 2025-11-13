import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { deleteVideoJob } from './repositoryVideoJob';
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
    const createdDate: string = event.pathParameters!.createdDate!;

    await deleteVideoJob(userId, createdDate);

    return noContent204Response();
  } catch (error) {
    console.log(error);
    return internalServerError500Response('Internal Server Error');
  }
};
