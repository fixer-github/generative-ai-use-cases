import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  AssignUserLicenseRequest,
  AssignUserLicenseResponse,
} from 'generative-ai-use-cases';
import { isAdmin, getUserId, successResponse, errorResponse } from './utils';
import { getPlan, assignPlan, getMyLicenseInfo } from '../utils/license';

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
    const req: AssignUserLicenseRequest = JSON.parse(event.body ?? '{}');
    if (req.planId !== null) {
      const plan = await getPlan(req.planId);
      if (!plan || !plan.enabled) {
        return errorResponse(400, 'Plan not found or disabled');
      }
    }
    await assignPlan(username, req.planId, getUserId(event));

    const license = await getMyLicenseInfo(username);
    const body: AssignUserLicenseResponse = { license };
    return successResponse(body);
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
