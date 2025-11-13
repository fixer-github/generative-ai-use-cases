/**
 * Common API Response utilities
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from '@generative-ai-use-cases/common';

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
