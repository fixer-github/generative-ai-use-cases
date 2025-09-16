import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyToken } from './utils/auth';

export interface AdminStatusResponse {
  isAdmin: boolean;
  tenantId: string;
  username: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  try {
    // Verify JWT token
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
    const username = claims['cognito:username'] || claims.username;

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Tenant ID not found in token' }),
      };
    }

    const response: AdminStatusResponse = {
      isAdmin,
      tenantId,
      username,
    };

    console.log(`Admin status check for user ${username}: isAdmin=${isAdmin}, tenantId=${tenantId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error checking admin status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: 'Failed to check admin status',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};