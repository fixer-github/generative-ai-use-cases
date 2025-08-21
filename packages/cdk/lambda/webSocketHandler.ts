import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GetConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { Err, Ok } from '../types/result';

const getConnectionInfo = async (
  callbackAPI: ApiGatewayManagementApiClient,
  connectionId: string
) => {
  try {
    const connectionInfo = await callbackAPI.send(
      new GetConnectionCommand({
        ConnectionId: connectionId,
      })
    );

    return Ok(connectionInfo);
  } catch (e) {
    console.log(e);

    return Err(e as Error);
  }
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  const callbackAPI = new ApiGatewayManagementApiClient({
    apiVersion: '2018-11-29',
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
  });

  const connectionInfo = await getConnectionInfo(callbackAPI, connectionId);

  if (!connectionInfo.ok) {
    return {
      statusCode: 500,
      body: JSON.stringify(connectionInfo.error),
    };
  }

  connectionInfo.value.connectionID = connectionId;

  await callbackAPI.send(
    new PostToConnectionCommand({
      ConnectionId: event.requestContext.connectionId,
      Data: `Use the sendmessage route to send a message. Your info:${JSON.stringify(connectionInfo)}`,
    })
  );

  return {
    statusCode: 200,
    body: '',
  };
};
