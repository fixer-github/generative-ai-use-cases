import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Client disconnected: ', event.requestContext.connectionId);

  return {
    statusCode: 200,
    body: 'Disconnected',
  };
};
