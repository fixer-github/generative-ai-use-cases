import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, ListUsersCommand, AttributeType } from '@aws-sdk/client-cognito-identity-provider';
import { verifyToken } from './utils/auth';

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION! });
const USER_POOL_ID = process.env.USER_POOL_ID!;

export interface TenantUser {
  username: string;
  email: string;
  tenantId: string;
  tenantAdmin: boolean;
  enabled: boolean;
  userStatus: string;
  createdDate: string;
  lastModifiedDate: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    const tenantId = claims['custom:tenant_id'];
    const isAdmin = claims['custom:tenantAdmin'] === 'true';

    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Access denied. Admin privileges required.' }),
      };
    }

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Tenant ID not found in token' }),
      };
    }

    // List users in the tenant
    const users: TenantUser[] = [];
    let paginationToken: string | undefined;

    do {
      const command = new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `custom:tenant_id = "${tenantId}"`,
        Limit: 60, // Maximum allowed by Cognito
        PaginationToken: paginationToken,
      });

      const response = await cognitoClient.send(command);
      
      if (response.Users) {
        for (const user of response.Users) {
          const getAttributeValue = (attributes: AttributeType[] | undefined, name: string): string => {
            return attributes?.find(attr => attr.Name === name)?.Value || '';
          };

          users.push({
            username: user.Username || '',
            email: getAttributeValue(user.Attributes, 'email'),
            tenantId: getAttributeValue(user.Attributes, 'custom:tenant_id'),
            tenantAdmin: getAttributeValue(user.Attributes, 'custom:tenantAdmin') === 'true',
            enabled: user.Enabled || false,
            userStatus: user.UserStatus || '',
            createdDate: user.UserCreateDate?.toISOString() || '',
            lastModifiedDate: user.UserLastModifiedDate?.toISOString() || '',
          });
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    console.log(`Found ${users.length} users for tenant ${tenantId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        users,
        totalCount: users.length,
      }),
    };

  } catch (error) {
    console.error('Error listing tenant users:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to list tenant users',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};