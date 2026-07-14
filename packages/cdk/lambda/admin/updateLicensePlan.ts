import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  UpdateLicensePlanRequest,
  UpdateLicensePlanResponse,
} from 'generative-ai-use-cases';
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
    const req: UpdateLicensePlanRequest = JSON.parse(event.body ?? '{}');
    const updated = {
      ...existing,
      ...(req.name !== undefined && { name: req.name }),
      ...(req.monthlyLimit !== undefined && {
        monthlyLimit: req.monthlyLimit,
      }),
      ...(req.enabled !== undefined && { enabled: req.enabled }),
      updatedDate: new Date().toISOString(),
    };
    await putPlan(updated);

    const body: UpdateLicensePlanResponse = { plan: updated };
    return successResponse(body);
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
