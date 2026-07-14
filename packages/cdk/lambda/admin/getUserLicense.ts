import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetUserLicenseResponse } from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse } from './utils';
import { getMyLicenseInfo } from '../utils/license';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }
    const username = event.pathParameters?.username;
    if (!username) {
      return errorResponse(400, 'username is required');
    }
    const license = await getMyLicenseInfo(username);
    const body: GetUserLicenseResponse = { license };
    return successResponse(body);
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
