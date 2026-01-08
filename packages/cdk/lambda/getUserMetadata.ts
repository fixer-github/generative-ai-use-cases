import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { verifyToken } from './utils/auth';
import {
  internalServerError500Response,
  ok200Response,
  unauthorized401Response,
} from './utils/apiResponse';

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_REGISTRATION_METADATA_TABLE_NAME =
  process.env.USER_REGISTRATION_METADATA_TABLE_NAME!;

interface GetUserMetadataResponse {
  metadata: Record<string, string>;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return unauthorized401Response({
        message: 'Authorization header is required',
      });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const claims = await verifyToken(token);
    if (!claims) {
      return unauthorized401Response({ message: 'Invalid or expired token' });
    }

    const userId = claims.sub;
    if (!userId) {
      return unauthorized401Response({
        message: 'User ID not found in token',
      });
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: USER_REGISTRATION_METADATA_TABLE_NAME,
        Key: { userId },
        ProjectionExpression: 'metadata',
      })
    );

    const metadata = (result.Item?.metadata as Record<string, string>) || {};

    return ok200Response<GetUserMetadataResponse>({ metadata });
  } catch (error) {
    console.error('Error getting user metadata:', error);
    return internalServerError500Response({
      message: 'Failed to get user metadata',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
