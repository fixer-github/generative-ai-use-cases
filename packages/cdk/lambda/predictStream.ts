import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Result } from '../types/result';
import * as repository from './repository';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const connections = await repository.scanWebSocketConnections();

  if (!connections.ok) {
    console.log(connections.error);

    return {
      statusCode: 500,
      body: JSON.stringify(connections.error),
    };
  }

  const callbackAPI = new ApiGatewayManagementApiClient({
    apiVersion: '2018-11-29',
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
  });

  const message = JSON.parse(event.body || '{}').message;
  const connectionItems = connections.value.Items || [];
  const sendMessages = connectionItems.map(async ({ connectionId }) => {
    if (connectionId.S! !== event.requestContext.connectionId!) {
      try {
        await callbackAPI.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId.S!,
            Data: message,
          })
        );
      } catch (e) {
        console.log(e);
      }
    }
  });

  try {
    await Promise.all(sendMessages);

    return {
      statusCode: 200,
      body: '',
    };
  } catch (err) {
    console.log(err);

    return {
      statusCode: 500,
      body: '',
    };
  }
};
