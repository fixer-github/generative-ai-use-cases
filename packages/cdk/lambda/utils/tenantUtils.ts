import { APIGatewayProxyEvent } from 'aws-lambda';
import { verifyToken } from './auth';

/**
 * Extract tenant ID from the JWT token in Authorization header
 * This is needed for Lambda functions that don't have Cognito authorizer
 */
export const getTenantIdFromJWT = async (event: APIGatewayProxyEvent): Promise<string> => {
  try {
    // Extract JWT token from Authorization header
    const idToken = event.headers.Authorization || event.headers.authorization;
    if (!idToken) {
      console.warn('No Authorization header found, using default tenant');
      return process.env.DEFAULT_TENANT_ID || 'default';
    }

    // Verify and decode the JWT token
    const payload = await verifyToken(idToken);
    if (!payload) {
      console.warn('Failed to verify JWT token, using default tenant');
      return process.env.DEFAULT_TENANT_ID || 'default';
    }

    // Extract tenant ID from custom claims
    const tenantId = payload['custom:tenant_id'] as string;
    if (!tenantId || tenantId === 'default') {
      console.warn('No tenant ID found in JWT claims, using default tenant');
      return process.env.DEFAULT_TENANT_ID || 'default';
    }

    console.log(`Successfully extracted tenant ID from JWT: ${tenantId}`);
    return tenantId;
  } catch (error) {
    console.error('Error extracting tenant ID from JWT:', error);
    return process.env.DEFAULT_TENANT_ID || 'default';
  }
};

/**
 * Extract tenant ID from the JWT claims in the API Gateway event
 */
export const getTenantId = (event: APIGatewayProxyEvent): string => {
  // Try to get tenant ID from authorizer claims (API Gateway Lambda authorizer)
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'] ||
    event.requestContext?.authorizer?.['custom:tenant_id'] ||
    // Fallback to a default tenant for backwards compatibility
    process.env.DEFAULT_TENANT_ID ||
    'default';

  if (!tenantId || tenantId === 'default') {
    console.warn('No tenant ID found in request, using default tenant');
  }

  return tenantId;
};

