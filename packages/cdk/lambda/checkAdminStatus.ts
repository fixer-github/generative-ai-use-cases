import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyAdminAccess, JWTClaims } from './utils/adminAuth';
import { verifyToken, verifyTokenWithRoleCheck } from './utils/auth';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  internalServerError500Response,
} from './utils/apiResponse';

export interface AdminStatusResponse {
  isAdmin: boolean;
  tenantId: string;
  username: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Extract token
    const token = event.headers.Authorization || event.headers.authorization;
    if (!token) {
      return unauthorized401Response({
        message: 'Missing authorization token',
      });
    }

    // Use real-time role checking to ensure consistency with other endpoints
    const verificationResult = await verifyTokenWithRoleCheck(token);
    if (!verificationResult) {
      return unauthorized401Response({ message: 'Invalid token' });
    }

    const { claims, isCurrentlyAdmin } = verificationResult;
    const tenantId = claims['custom:tenant_id'];
    const username = claims['cognito:username'] || claims.username || '';

    if (!tenantId) {
      return badRequest400Response({ message: 'Tenant ID not found in token' });
    }

    const response: AdminStatusResponse = {
      isAdmin: isCurrentlyAdmin, // Use real-time admin status from Cognito
      tenantId,
      username,
    };

    console.log(
      `Admin status check for user ${username}: isAdmin=${isCurrentlyAdmin}, tenantId=${tenantId}`
    );

    return ok200Response(response);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return internalServerError500Response(
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
};
