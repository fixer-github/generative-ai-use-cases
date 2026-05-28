import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export function successResponse(
  data: unknown,
  statusCode: number = 200
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

export function errorResponse(
  message: string,
  statusCode: number = 400,
  extra?: Record<string, unknown>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message, ...extra }),
  };
}
