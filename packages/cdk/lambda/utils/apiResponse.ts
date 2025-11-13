/**
 * Common API Response utilities
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS, HttpStatus } from '@generative-ai-use-cases/common';

/**
 * Create Lambda success response
 * @param statusCode HTTP status code
 * @param body Response body
 * @returns Lambda response
 */
function createSuccessResponse<TBody>(
  statusCode: number,
  body: TBody
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Create Lambda error response
 * @param statusCode HTTP status code
 * @param message Error Message
 * @returns Lambda response
 */
function createErrorResponse(
  statusCode: number,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: message }),
  };
}

// ============================================================================
// Success Responses (2xx)
// ============================================================================

/**
 * Create 200 OK response
 * @param body Response body
 * @returns Lambda response with 200 status code
 */
export function ok200Response<TBody>(body: TBody): APIGatewayProxyResult {
  return createSuccessResponse(HttpStatus.Success.OK, body);
}

/**
 * Create 201 Created response
 * @param body Response body
 * @returns Lambda response with 201 status code
 */
export function created201Response<TBody>(body: TBody): APIGatewayProxyResult {
  return createSuccessResponse(HttpStatus.Success.CREATED, body);
}

/**
 * Create 202 Accepted response
 * @param body Response body
 * @returns Lambda response with 202 status code
 */
export function accepted202Response<TBody>(body: TBody): APIGatewayProxyResult {
  return createSuccessResponse(HttpStatus.Success.ACCEPTED, body);
}

/**
 * Create 204 No Content response
 * @returns Lambda response with 204 status code
 */
export function noContent204Response(): APIGatewayProxyResult {
  return createSuccessResponse(HttpStatus.Success.NO_CONTENT, null);
}

// ============================================================================
// Client Error Responses (4xx)
// ============================================================================

/**
 * Create 400 Bad Request response
 * @param message Error message
 * @returns Lambda response with 400 status code
 */
export function badRequest400Response(message: string): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.BAD_REQUEST, message);
}

/**
 * Create 401 Unauthorized response
 * @param message Error message
 * @returns Lambda response with 401 status code
 */
export function unauthorized401Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.UNAUTHORIZED, message);
}

/**
 * Create 403 Forbidden response
 * @param message Error message
 * @returns Lambda response with 403 status code
 */
export function forbidden403Response(message: string): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.FORBIDDEN, message);
}

/**
 * Create 404 Not Found response
 * @param message Error message
 * @returns Lambda response with 404 status code
 */
export function notFound404Response(message: string): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.NOT_FOUND, message);
}

/**
 * Create 405 Method Not Allowed response
 * @param message Error message
 * @returns Lambda response with 405 status code
 */
export function methodNotAllowed405Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatus.ClientError.METHOD_NOT_ALLOWED,
    message
  );
}

/**
 * Create 409 Conflict response
 * @param message Error message
 * @returns Lambda response with 409 status code
 */
export function conflict409Response(message: string): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.CONFLICT, message);
}

/**
 * Create 422 Unprocessable Entity response
 * @param message Error message
 * @returns Lambda response with 422 status code
 */
export function unprocessableEntity422Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatus.ClientError.UNPROCESSABLE_ENTITY,
    message
  );
}

/**
 * Create 429 Too Many Requests response
 * @param message Error message
 * @returns Lambda response with 429 status code
 */
export function tooManyRequests429Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ClientError.TOO_MANY_REQUESTS, message);
}

// ============================================================================
// Server Error Responses (5xx)
// ============================================================================

/**
 * Create 500 Internal Server Error response
 * @param message Error message
 * @returns Lambda response with 500 status code
 */
export function internalServerError500Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatus.ServerError.INTERNAL_SERVER_ERROR,
    message
  );
}

/**
 * Create 501 Not Implemented response
 * @param message Error message
 * @returns Lambda response with 501 status code
 */
export function notImplemented501Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ServerError.NOT_IMPLEMENTED, message);
}

/**
 * Create 502 Bad Gateway response
 * @param message Error message
 * @returns Lambda response with 502 status code
 */
export function badGateway502Response(message: string): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ServerError.BAD_GATEWAY, message);
}

/**
 * Create 503 Service Unavailable response
 * @param message Error message
 * @returns Lambda response with 503 status code
 */
export function serviceUnavailable503Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatus.ServerError.SERVICE_UNAVAILABLE,
    message
  );
}

/**
 * Create 504 Gateway Timeout response
 * @param message Error message
 * @returns Lambda response with 504 status code
 */
export function gatewayTimeout504Response(
  message: string
): APIGatewayProxyResult {
  return createErrorResponse(HttpStatus.ServerError.GATEWAY_TIMEOUT, message);
}
