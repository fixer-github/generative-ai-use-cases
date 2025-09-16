import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  CognitoIdentityProviderClient, 
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  AttributeType
} from '@aws-sdk/client-cognito-identity-provider';
import { verifyToken } from './utils/auth';

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION! });
const USER_POOL_ID = process.env.USER_POOL_ID!;

export interface UpdateUserRoleRequest {
  username: string;
  tenantAdmin: boolean;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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
    let requestBody: UpdateUserRoleRequest;
    try {
      requestBody = JSON.parse(event.body || '{}');
    } catch (error) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Invalid JSON in request body' }),
      };
    }

    const { username, tenantAdmin } = requestBody;

    if (!username || typeof tenantAdmin !== 'boolean') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'username (string) and tenantAdmin (boolean) are required' 
        }),
      };
    }

    // Prevent admin from removing their own admin status
    if (username === currentUsername && !tenantAdmin) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: 'Cannot remove admin privileges from yourself' 
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
            message: 'Cannot modify user from different tenant' 
          }),
        };
      }

      // Update user role
      const updateCommand = new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [
          {
            Name: 'custom:tenantAdmin',
            Value: tenantAdmin.toString(),
          },
        ],
      });

      await cognitoClient.send(updateCommand);

      console.log(`Successfully updated user ${username} tenantAdmin status to ${tenantAdmin}`);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'User role updated successfully',
          username,
          tenantAdmin,
        }),
      };

    } catch (error: any) {
      console.error(`Failed to update user ${username}:`, error);

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
    console.error('Error updating user role:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to update user role',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};