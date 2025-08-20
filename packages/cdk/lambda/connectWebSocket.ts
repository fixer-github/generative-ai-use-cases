import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as repository from './repository';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const apiId = event.requestContext.apiId;
  const domainName = event.requestContext.domainName!;
  const stage = event.requestContext.stage;

  const endpoint = `${domainName}/${stage}`;

  const apiType = determineApiType(domainName);

  try {
    // 接続情報をDynamoDBに保存
    await repository.createWebSocketConnection(
      connectionId,
      apiId,
      endpoint,
      apiType
    );

    return {
      statusCode: 200,
      body: 'Connected',
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify(err),
    };
  }
};

// TODO: いい感じにする
const determineApiType = (domainName: string): string => {
  // ドメイン名やその他の情報からAPIの種類を判定
  // 実際の実装では、環境変数やAPIのメタデータを使用
  if (domainName.includes('chat')) return 'CHAT';
  if (domainName.includes('game')) return 'GAME';
  return 'UNKNOWN';
};
