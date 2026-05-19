import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const successResponse = (
  body: unknown,
  statusCode = 200
): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

export const errorResponse = (
  statusCode: number,
  message: string
): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify({ message }),
});

export const isAdmin = (event: APIGatewayProxyEvent): boolean => {
  const groups =
    event.requestContext.authorizer?.claims['cognito:groups'] ?? '';
  // cognito:groups is a comma-separated string when multiple groups exist
  return groups.split(',').includes('admin');
};

export const getUserId = (event: APIGatewayProxyEvent): string => {
  return event.requestContext.authorizer!.claims['cognito:username'];
};
