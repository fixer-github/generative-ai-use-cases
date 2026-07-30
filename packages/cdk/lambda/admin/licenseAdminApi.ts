/**
 * Admin license endpoints, routed in one Lambda to keep the CloudFormation
 * resource count down (the stack is near the 500-resource limit):
 *   GET    /admin/license/plans             ... list plans
 *   POST   /admin/license/plans             ... create plan
 *   PUT    /admin/license/plans/{planId}    ... update plan
 *   DELETE /admin/license/plans/{planId}    ... disable plan (soft delete)
 *   GET    /admin/license/usage-summary     ... per-user remaining % summary
 *   GET    /admin/users/{username}/license  ... one user's license status
 *   PUT    /admin/users/{username}/license  ... assign / change / unassign
 */
import { randomUUID } from 'crypto';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  AssignUserLicenseRequest,
  AssignUserLicenseResponse,
  CreateLicensePlanRequest,
  CreateLicensePlanResponse,
  GetLicenseUsageSummaryResponse,
  GetUserLicenseResponse,
  LicensePlan,
  LicenseUsageSummaryEntry,
  ListLicensePlansResponse,
  UpdateLicensePlanRequest,
  UpdateLicensePlanResponse,
} from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse, getUserId } from './utils';
import {
  assignPlan,
  getLicenseStatus,
  getPlan,
  listAssignments,
  listPlans,
  putPlan,
} from '../utils/license';

const listLicensePlans = async (): Promise<APIGatewayProxyResult> => {
  const plans = await listPlans();
  plans.sort((a, b) => a.monthlyFeeYen - b.monthlyFeeYen);
  const response: ListLicensePlansResponse = { plans };
  return successResponse(response);
};

const createLicensePlan = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const req: CreateLicensePlanRequest = JSON.parse(event.body ?? '{}');
  if (!req.name?.trim()) {
    return errorResponse(400, 'name is required');
  }
  if (!(req.monthlyFeeYen >= 0)) {
    return errorResponse(400, 'monthlyFeeYen must be a number >= 0');
  }
  if (!(req.allocationYen > 0)) {
    return errorResponse(400, 'allocationYen must be a number > 0');
  }
  if (!Array.isArray(req.allowedModelIds) || req.allowedModelIds.length === 0) {
    return errorResponse(400, 'allowedModelIds must be a non-empty array');
  }

  const now = new Date().toISOString();
  const plan: LicensePlan = {
    planId: randomUUID(),
    name: req.name.trim(),
    monthlyFeeYen: req.monthlyFeeYen,
    allocationYen: req.allocationYen,
    allowedModelIds: req.allowedModelIds,
    enabled: req.enabled ?? true,
    createdDate: now,
    updatedDate: now,
  };
  await putPlan(plan);
  const response: CreateLicensePlanResponse = { plan };
  return successResponse(response, 201);
};

const updateLicensePlan = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const planId = event.pathParameters?.planId;
  if (!planId) {
    return errorResponse(400, 'planId is required');
  }
  const current = await getPlan(planId);
  if (!current) {
    return errorResponse(404, 'Plan not found');
  }
  const req: UpdateLicensePlanRequest = JSON.parse(event.body ?? '{}');
  if (req.name !== undefined && !req.name.trim()) {
    return errorResponse(400, 'name must not be empty');
  }
  if (req.monthlyFeeYen !== undefined && !(req.monthlyFeeYen >= 0)) {
    return errorResponse(400, 'monthlyFeeYen must be a number >= 0');
  }
  if (req.allocationYen !== undefined && !(req.allocationYen > 0)) {
    return errorResponse(400, 'allocationYen must be a number > 0');
  }
  if (
    req.allowedModelIds !== undefined &&
    (!Array.isArray(req.allowedModelIds) || req.allowedModelIds.length === 0)
  ) {
    return errorResponse(400, 'allowedModelIds must be a non-empty array');
  }

  const plan: LicensePlan = {
    ...current,
    name: req.name?.trim() ?? current.name,
    monthlyFeeYen: req.monthlyFeeYen ?? current.monthlyFeeYen,
    allocationYen: req.allocationYen ?? current.allocationYen,
    allowedModelIds: req.allowedModelIds ?? current.allowedModelIds,
    enabled: req.enabled ?? current.enabled,
    updatedDate: new Date().toISOString(),
  };
  await putPlan(plan);
  const response: UpdateLicensePlanResponse = { plan };
  return successResponse(response);
};

// "Delete" disables the plan instead of removing the item, so existing
// assignments still resolve (and their users become unusable, requirement 12).
const deleteLicensePlan = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const planId = event.pathParameters?.planId;
  if (!planId) {
    return errorResponse(400, 'planId is required');
  }
  const current = await getPlan(planId);
  if (!current) {
    return errorResponse(404, 'Plan not found');
  }
  await putPlan({
    ...current,
    enabled: false,
    updatedDate: new Date().toISOString(),
  });
  return successResponse({ planId });
};

// Summary across all assigned users, used by the admin user list to show
// per-user remaining % and the number of users who hit the limit
// (requirement 35).
const getLicenseUsageSummary = async (): Promise<APIGatewayProxyResult> => {
  const assignments = await listAssignments();
  const entries: LicenseUsageSummaryEntry[] = [];
  for (const { userId } of assignments) {
    const status = await getLicenseStatus(userId);
    entries.push({
      userId,
      planId: status.planId,
      planName: status.planName,
      pendingPlanName: status.pendingPlanName,
      assigned: status.assigned,
      remainingPercent: status.remainingPercent,
      exhausted: status.assigned && status.remainingPercent <= 0,
    });
  }
  const response: GetLicenseUsageSummaryResponse = {
    entries,
    exhaustedCount: entries.filter((e) => e.exhausted).length,
  };
  return successResponse(response);
};

const getUserLicense = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const username = event.pathParameters?.username;
  if (!username) {
    return errorResponse(400, 'username is required');
  }
  const license = await getLicenseStatus(username);
  const response: GetUserLicenseResponse = { license };
  return successResponse(response);
};

const assignUserLicense = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
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
  const applied = await assignPlan(username, req.planId, getUserId(event));
  const license = await getLicenseStatus(username);
  const response: AssignUserLicenseResponse = { license, applied };
  return successResponse(response);
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }
    const route = `${event.httpMethod} ${event.resource}`;

    switch (route) {
      case 'GET /admin/license/plans':
        return await listLicensePlans();
      case 'POST /admin/license/plans':
        return await createLicensePlan(event);
      case 'PUT /admin/license/plans/{planId}':
        return await updateLicensePlan(event);
      case 'DELETE /admin/license/plans/{planId}':
        return await deleteLicensePlan(event);
      case 'GET /admin/license/usage-summary':
        return await getLicenseUsageSummary();
      case 'GET /admin/users/{username}/license':
        return await getUserLicense(event);
      case 'PUT /admin/users/{username}/license':
        return await assignUserLicense(event);
      default:
        return errorResponse(404, 'Not Found');
    }
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
