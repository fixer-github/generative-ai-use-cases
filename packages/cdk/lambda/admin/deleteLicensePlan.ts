import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin, successResponse, errorResponse } from './utils';
import { getPlan, putPlan } from '../utils/license';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }
    const planId = event.pathParameters?.planId;
    if (!planId) {
      return errorResponse(400, 'planId is required');
    }
    const existing = await getPlan(planId);
    if (!existing) {
      return errorResponse(404, 'Plan not found');
    }
    // Disable instead of delete, so assignments referencing the plan stay resolvable (design doc 5.1)
    await putPlan({
      ...existing,
      enabled: false,
      updatedDate: new Date().toISOString(),
    });
    return successResponse({ planId, enabled: false });
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
