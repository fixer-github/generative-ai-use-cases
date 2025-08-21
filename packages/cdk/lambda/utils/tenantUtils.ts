import { APIGatewayProxyEvent } from 'aws-lambda';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * Extract tenant ID from the JWT claims in the API Gateway event
 */
export const getTenantId = (event: APIGatewayProxyEvent): string => {
  // Try to get tenant ID from authorizer claims (API Gateway Lambda authorizer)
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'] ||
    event.requestContext?.authorizer?.['custom:tenant_id'] ||
    // Fallback to a default tenant for backwards compatibility
    DEFAULT_TENANT_ID;

  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    console.warn('No tenant ID found in request, using default tenant');
  }

  return tenantId;
};

