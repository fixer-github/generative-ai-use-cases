import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const connectionId = event.requestContext.connectionId!;
    await repository.deleteWebSocketConnection(connectionId);

    return {
      statusCode: 204,
    };
  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to disconnect',
        error: err,
      }),
    };
  }
};
