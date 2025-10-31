import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Parse claims from authorizer context
 * Handles both stringified claims (Lambda Request Authorizer) and direct objects (Cognito User Pools Authorizer)
 */
function parseClaims(event: APIGatewayProxyEvent): Record<string, string> | null {
  const claimsValue = event.requestContext?.authorizer?.claims;

  if (!claimsValue) {
    return null;
  }

  // If already an object, return it (Cognito User Pools Authorizer format)
  if (typeof claimsValue === 'object' && !Array.isArray(claimsValue)) {
    return claimsValue as Record<string, string>;
  }

  // If string, parse it (Lambda Request Authorizer format - stringified JSON)
  if (typeof claimsValue === 'string') {
    try {
      return JSON.parse(claimsValue) as Record<string, string>;
    } catch (error) {
      console.error('Failed to parse claims:', error);
      return null;
    }
  }

  return null;
}

/**
 * Extract tenant ID from the JWT claims in the API Gateway event
 */
export const getTenantId = (event: APIGatewayProxyEvent): string => {
  // Try to get tenant ID from authorizer context (Lambda Request Authorizer - flat structure)
  const tenantId =
    event.requestContext?.authorizer?.['custom:tenant_id'] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.['custom:tenant_id'] ||
    // Fallback to a default tenant for backwards compatibility
    process.env.DEFAULT_TENANT_ID ||
    'default';

  if (!tenantId || tenantId === 'default') {
    console.warn('No tenant ID found in request, using default tenant');
  }

  return tenantId;
};

/**
 * Alias for getTenantId for consistency with new naming convention
 */
export const getUserTenantId = (event: APIGatewayProxyEvent): string => {
  return getTenantId(event);
};

/**
 * Extract username from the API Gateway event authorizer context
 */
export const getUsername = (event: APIGatewayProxyEvent): string => {
  // Try to get username from authorizer context (Lambda Request Authorizer - flat structure)
  const username =
    event.requestContext?.authorizer?.['cognito:username'] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.['cognito:username'] ||
    'unknown';

  return username;
};

/**
 * Extract sub (user ID) from the API Gateway event authorizer context
 */
export const getSub = (event: APIGatewayProxyEvent): string => {
  // Try to get sub from authorizer context (Lambda Request Authorizer - flat structure)
  const sub =
    event.requestContext?.authorizer?.['sub'] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.['sub'] ||
    '';

  return sub;
};

/**
 * Extract email from the API Gateway event authorizer context
 */
export const getEmail = (event: APIGatewayProxyEvent): string | undefined => {
  // Try to get email from authorizer context (Lambda Request Authorizer - flat structure)
  const email =
    event.requestContext?.authorizer?.['email'] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.['email'];

  return email || undefined;
};

/**
 * Extract tenant admin flag from the API Gateway event authorizer context
 * Returns true if the user is a tenant admin, false otherwise
 */
export const getTenantAdmin = (event: APIGatewayProxyEvent): boolean => {
  // Try to get tenantAdmin from authorizer context (Lambda Request Authorizer - flat structure)
  const tenantAdmin =
    event.requestContext?.authorizer?.['custom:tenantAdmin'] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.['custom:tenantAdmin'];

  return tenantAdmin === 'true';
};

/**
 * Generic claim extractor from the API Gateway event authorizer context
 * @param event - The API Gateway proxy event
 * @param claimName - The name of the claim to extract (e.g., 'custom:is_admin', 'email_verified')
 * @returns The claim value as a string, or undefined if not found
 */
export const getClaim = (
  event: APIGatewayProxyEvent,
  claimName: string
): string | undefined => {
  // Try to get claim from authorizer context (Lambda Request Authorizer - flat structure)
  const claim =
    event.requestContext?.authorizer?.[claimName] ||
    // Try to get from parsed claims object (Lambda Request Authorizer - nested structure or Cognito User Pools)
    parseClaims(event)?.[claimName];

  return claim || undefined;
};
