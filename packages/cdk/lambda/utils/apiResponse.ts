/**
 * Common API Response utilities
 */

import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * CORS headers
 */
export const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

/**
 * Create Lambda error response
 * @param statusCode HTTP status code
 * @param message Error Message
 * @returns Lambda response
 */
export function createErrorResponse(
  statusCode: number,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: message }),
  };
}

/**
 * Create Lambda success response
 * @param statusCode HTTP status code
 * @param body Response body
 * @returns Lambda response
 */
export function createSuccessResponse<TBody>(
  statusCode: number,
  body: TBody
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
