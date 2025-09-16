import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  CognitoIdentityProviderClient, 
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminDisableUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { verifyToken } from './utils/auth';

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION! });
const USER_POOL_ID = process.env.USER_POOL_ID!;

export interface RemoveUserRequest {
  username: string;
  action?: 'disable' | 'delete'; // default: 'disable'
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  };

  try {
    // Verify JWT token and admin status
    const token = event.headers.Authorization || event.headers.authorization;
    if (!token) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Missing authorization token' }),
      };
    }

    const claims = await verifyToken(token);
    if (!claims) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Invalid token' }),
      };
    }

    const currentUserTenantId = claims['custom:tenant_id'];
    const currentUsername = claims['cognito:username'] || claims.username;
    const isCurrentUserAdmin = claims['custom:tenantAdmin'] === 'true';

    if (!isCurrentUserAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Access denied. Admin privileges required.' }),
      };
    }

    if (!currentUserTenantId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Tenant ID not found in token' }),
      };
    }

    // Parse request body
    let requestBody: RemoveUserRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Invalid JSON in request body' }),
      };
    }

    const { username, action = 'disable' } = requestBody;

    if (!username) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'username is required' }),
      };
    }

    if (action !== 'disable' && action !== 'delete') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'action must be either "disable" or "delete"' 
        }),
      };
    }

    // Prevent admin from removing themselves
    if (username === currentUsername) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Cannot remove yourself' 
        }),
      };
    }

    // Get target user details to verify tenant membership
    try {
      const getUserCommand = new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      });

      const userResponse = await cognitoClient.send(getUserCommand);
      
      if (!userResponse.UserAttributes) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'User not found' }),
        };
      }

      // Check if user belongs to the same tenant
      const userTenantId = userResponse.UserAttributes.find(
        attr => attr.Name === 'custom:tenant_id'
      )?.Value;

      if (userTenantId !== currentUserTenantId) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Cannot remove user from different tenant' 
          }),
        };
      }

      // Perform the requested action
      if (action === 'delete') {
        const deleteCommand = new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });

        await cognitoClient.send(deleteCommand);
        console.log(`Successfully deleted user: ${username}`);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'User deleted successfully',
            username,
            action: 'deleted',
          }),
        };

      } else { // action === 'disable'
        const disableCommand = new AdminDisableUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        });

        await cognitoClient.send(disableCommand);
        console.log(`Successfully disabled user: ${username}`);

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            message: 'User disabled successfully',
            username,
            action: 'disabled',
          }),
        };
      }

    } catch (error: any) {
      console.error(`Failed to ${action} user ${username}:`, error);

      if (error.name === 'UserNotFoundException') {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ message: 'User not found' }),
        };
      }

      throw error; // Re-throw to be caught by outer catch block
    }

  } catch (error) {
    console.error('Error removing user:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to remove user',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};