import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Get user ID from Cognito authorizer claims
 *
 * @param event API Gateway Proxy Event with Cognito authorizer
 * @returns User ID (cognito:username) or undefined if not found
 */
export function getUserIdFromCognitoEvent(
  event: APIGatewayProxyEvent
): string | undefined {
  return event.requestContext?.authorizer?.claims?.['cognito:username'];
}

/**
 * Get user email from Cognito authorizer claims
 *
 * @param event API Gateway Proxy Event with Cognito authorizer
 * @returns User email or undefined if not found
 */
export function getUserEmailFromCognitoEvent(
  event: APIGatewayProxyEvent
): string | undefined {
  return event.requestContext?.authorizer?.claims?.['email'];
}

/**
 * Get all user claims from Cognito authorizer
 *
 * @param event API Gateway Proxy Event with Cognito authorizer
 * @returns All user claims or undefined if not found
 */
export function getUserClaimsFromCognitoEvent(
  event: APIGatewayProxyEvent
): Record<string, any> | undefined {
  return event.requestContext?.authorizer?.claims;
}