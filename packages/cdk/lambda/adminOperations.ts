import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createResponse } from './utils/api';

/**
 * HACK: Consolidated admin operations handler to work around AWS CloudFormation's 500 resource limit.
 * 
 * This handler combines multiple admin operations that would ideally be separate Lambda functions.
 * 
 * This consolidation is NOT recommended for production best practices as it:
 * - Reduces granular IAM permission control
 * - Makes monitoring individual operations harder
 * - Couples unrelated functionalities
 * - Increases Lambda package size and cold start time
 * 
 * TODO: When the stack grows, consider:
 * 1. Splitting into multiple CloudFormation stacks
 * 2. Using nested stacks
 * 3. Adopting AWS CDK patterns for large applications
 * 
 * @param event API Gateway proxy event
 * @returns API Gateway proxy result
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const path = event.path;
  const method = event.httpMethod;
  
  console.log(`[adminOperations] Handling ${method} ${path}`);
  
  try {
    // Route to appropriate handler based on path and method
    // HACK: Manual routing because we're avoiding API Gateway resource proliferation
    
    // Future consolidation point for other admin operations
    // Uncomment and migrate when approaching resource limits again:
    // if (path.endsWith('/admin/users')) { ... }
    // if (path.endsWith('/admin/users/invite')) { ... }
    
    return createResponse(404, { message: 'Not found' });
  } catch (error) {
    console.error('[adminOperations] Error:', error);
    return createResponse(500, { 
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};