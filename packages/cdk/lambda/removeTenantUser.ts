import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  verifyAdminAccessWithUser,
  isAdminUserResult,
} from './utils/adminAuth';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from './utils/apiResponse';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION!,
});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export interface RemoveUserRequest {
  username: string;
  action?: 'disable' | 'delete'; // default: 'disable'
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body first to get username
    let requestBody: RemoveUserRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return badRequest400Response('Invalid JSON in request body');
    }

    const { username, action = 'disable' } = requestBody;

    if (!username) {
      return badRequest400Response('username is required');
    }

    if (action !== 'disable' && action !== 'delete') {
      return badRequest400Response(
        'action must be either "disable" or "delete"'
      );
    }

    // Verify admin access and user membership in same tenant
    const result = await verifyAdminAccessWithUser(event, username);
    if (!isAdminUserResult(result)) {
      return result;
    }

    const { admin } = result;

    // Prevent admin from removing themselves
    if (username === admin.username) {
      return badRequest400Response('Cannot remove yourself');
    }

    // Perform the user removal action
    try {
      if (action === 'delete') {
        const deleteCommand = new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });

        await cognitoClient.send(deleteCommand);
        console.log(`Successfully deleted user: ${username}`);
      } else {
        const disableCommand = new AdminDisableUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });

        await cognitoClient.send(disableCommand);
        console.log(`Successfully disabled user: ${username}`);
      }

      return ok200Response({
        message: `User ${action === 'delete' ? 'deleted' : 'disabled'} successfully`,
        username,
        action,
      });
    } catch (error: unknown) {
      console.error(`Failed to ${action} user ${username}:`, error);

      if (error instanceof Error && error.name === 'UserNotFoundException') {
        return notFound404Response('User not found');
      }

      throw error; // Re-throw to be caught by outer catch block
    }
  } catch (error) {
    console.error('Error removing user:', error);
    return internalServerError500Response('Failed to remove user');
  }
};
