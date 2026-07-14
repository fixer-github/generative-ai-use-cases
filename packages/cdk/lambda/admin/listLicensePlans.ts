import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ListLicensePlansResponse } from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse } from './utils';
import { listPlans } from '../utils/license';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }
    const plans = await listPlans();
    const body: ListLicensePlansResponse = { plans };
    return successResponse(body);
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
