import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getTenantUseCaseConfiguration, getTenant } from './tenantManager';
import { getUserTenantId } from './utils/tenantUtils';
import { createResponse } from './utils/api';
import { 
  parseGlobalHiddenUseCases, 
  createUseCaseConfigResponse 
} from './utils/useCaseConfig';

/**
 * This endpoint provides tenant-aware use case configuration for the frontend.
 * It combines global configuration with tenant-specific overrides.
 * Unlike the admin endpoint, this doesn't require admin privileges - any authenticated user can access their tenant's configuration.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(`[getTenantAwareUseCaseConfig] Called with event: ${JSON.stringify(event)}`);

  try {
    const globalHiddenUseCases = parseGlobalHiddenUseCases();
    
    // Extract tenant ID from user claims
    const tenantId = getUserTenantId(event);
    if (!tenantId) {
      console.log('[getTenantAwareUseCaseConfig] No tenant ID found, using global configuration');
      // If no tenant ID, return global configuration
      return createResponse(200, createUseCaseConfigResponse(null, globalHiddenUseCases, 'global'));
    }

    console.log(`[getTenantAwareUseCaseConfig] Getting configuration for tenant: ${tenantId}`);

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
    console.error('[getTenantAwareUseCaseConfig] Error:', error);
    
    // In case of error, return global configuration as fallback
    const globalHiddenUseCases = parseGlobalHiddenUseCases();
    return createResponse(200, createUseCaseConfigResponse(
      null,
      globalHiddenUseCases,
      'global_fallback',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    ));
  }
};