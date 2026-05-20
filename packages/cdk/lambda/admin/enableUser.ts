import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminEnableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { isAdmin, successResponse, errorResponse } from './utils';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }

    const username = event.pathParameters!.username!;

    await client.send(
      new AdminEnableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );

    return successResponse({ message: 'User enabled successfully' });
  } catch (error) {
    console.log(error);
    if ((error as { name?: string }).name === 'UserNotFoundException') {
      return errorResponse(404, 'User not found');
    }
    return errorResponse(500, 'Internal Server Error');
  }
};
