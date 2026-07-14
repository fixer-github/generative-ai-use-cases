import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import {
  CreateLicensePlanRequest,
  CreateLicensePlanResponse,
  LicensePlan,
} from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse } from './utils';
import { putPlan } from '../utils/license';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }
    const req: CreateLicensePlanRequest = JSON.parse(event.body ?? '{}');
    if (
      !req.name ||
      !Number.isFinite(req.monthlyLimit) ||
      req.monthlyLimit < 0
    ) {
      return errorResponse(
        400,
        'name and a non-negative monthlyLimit are required'
      );
    }

    const now = new Date().toISOString();
    const plan: LicensePlan = {
      planId: crypto.randomUUID(),
      name: req.name,
      monthlyLimit: req.monthlyLimit,
      enabled: req.enabled ?? true,
      createdDate: now,
      updatedDate: now,
    };
    await putPlan(plan);

    const body: CreateLicensePlanResponse = { plan };
    return successResponse(body, 201);
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
