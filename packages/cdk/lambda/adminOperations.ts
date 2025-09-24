import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getTenantUseCaseConfiguration, getTenant, updateTenantUseCaseConfiguration } from './tenantManager';
import { getUserTenantId } from './utils/tenantUtils';
import { verifyAdminAccess, isAdminContext } from './utils/adminAuth';
import { createResponse } from './utils/api';
import { 
  parseGlobalHiddenUseCases, 
  createUseCaseConfigResponse 
} from './utils/useCaseConfig';

/**
 * HACK: Consolidated admin operations handler to work around AWS CloudFormation's 500 resource limit.
 * 
 * This handler combines multiple admin operations that would ideally be separate Lambda functions:
 * - GET /admin/use-case-config: Get tenant use case configuration
 * - PUT /admin/use-case-config: Update tenant use case configuration
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
    if (path.endsWith('/admin/use-case-config')) {
      switch (method) {
        case 'GET':
          return await handleGetUseCaseConfig(event);
        case 'PUT':
          return await handleUpdateUseCaseConfig(event);
        default:
          return createResponse(405, { message: 'Method not allowed' });
      }
    }
    
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

/**
 * Get tenant-aware use case configuration
 * Migrated from getTenantAwareUseCaseConfig.ts to reduce Lambda resources
 */
async function handleGetUseCaseConfig(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('[adminOperations:getUseCaseConfig] Processing request');
  
  try {
    const globalHiddenUseCases = parseGlobalHiddenUseCases();
    
    // Extract tenant ID from user claims
    const tenantId = getUserTenantId(event);
    if (!tenantId) {
      console.log('[adminOperations:getUseCaseConfig] No tenant ID found, using global configuration');
      return createResponse(200, createUseCaseConfigResponse(null, globalHiddenUseCases, 'global'));
    }

    console.log(`[adminOperations:getUseCaseConfig] Getting configuration for tenant: ${tenantId}`);

    // Get tenant-specific use case configuration with fallback to global
    const effectiveHiddenUseCases = await getTenantUseCaseConfiguration(
      tenantId,
      globalHiddenUseCases
    );

    // Determine if configuration came from tenant-specific settings or global fallback
    const tenant = await getTenant(tenantId);
    const hasTenantSpecificConfig = tenant?.useCaseConfiguration && 
      Object.keys(tenant.useCaseConfiguration.hiddenUseCases || {}).length > 0;

    return createResponse(200, createUseCaseConfigResponse(
      tenantId,
      effectiveHiddenUseCases,
      hasTenantSpecificConfig ? 'tenant' : 'global',
      { globalHiddenUseCases }
    ));
  } catch (error) {
    console.error('[adminOperations:getUseCaseConfig] Error:', error);
    return createResponse(500, { 
      message: 'Failed to get use case configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Update tenant use case configuration (admin only)
 * Migrated from updateTenantUseCaseConfiguration.ts to reduce Lambda resources
 */
async function handleUpdateUseCaseConfig(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('[adminOperations:updateUseCaseConfig] Processing request');
  
  try {
    // Verify admin role
    const adminResult = await verifyAdminAccess(event);
    if (!isAdminContext(adminResult)) {
      return adminResult; // Return the error response
    }
    
    const tenantId = adminResult.tenantId;

    // Parse request body
    if (!event.body) {
      return createResponse(400, { message: 'Request body is required' });
    }

    const body = JSON.parse(event.body);
    const { hiddenUseCases } = body;

    if (hiddenUseCases === undefined) {
      return createResponse(400, { message: 'hiddenUseCases field is required' });
    }

    console.log(`[adminOperations:updateUseCaseConfig] Updating configuration for tenant: ${tenantId}`);

    // Update tenant configuration
    await updateTenantUseCaseConfiguration({ 
      tenantId, 
      hiddenUseCases, 
      updatedBy: adminResult.username 
    });

    // Get updated configuration for response
    const globalHiddenUseCases = parseGlobalHiddenUseCases();
    const effectiveHiddenUseCases = await getTenantUseCaseConfiguration(
      tenantId,
      globalHiddenUseCases
    );

    return createResponse(200, {
      message: 'Use case configuration updated successfully',
      configuration: createUseCaseConfigResponse(
        tenantId,
        effectiveHiddenUseCases,
        'tenant',
        { globalHiddenUseCases }
      )
    });
  } catch (error) {
    console.error('[adminOperations:updateUseCaseConfig] Error:', error);
    return createResponse(500, { 
      message: 'Failed to update use case configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}