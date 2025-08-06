import { APIGatewayProxyResult } from 'aws-lambda';

export const SuccessResponse = <TResponse>(
  body: TResponse
): APIGatewayProxyResult => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
};

export const NotFoundResponse = (message: string): APIGatewayProxyResult => {
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: message,
    }),
  };
};

export const InternalServerErrorResponse = (
  message: string
): APIGatewayProxyResult => {
  return {
    statusCode: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ message: message }),
  };
};
