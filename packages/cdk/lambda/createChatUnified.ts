import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createChat } from './repositoryUnified';

/**
 * Example Lambda handler using the unified approach
 * 
 * Benefits:
 * 1. Simple API interface (no credential management in frontend)
 * 2. IAM-level security (AWS enforces tenant boundaries)  
 * 3. Credential caching (good performance)
 * 4. CloudTrail audit trail (security compliance)
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('CreateChat handler invoked', {
    path: event.path,
    tenantId: event.requestContext.authorizer?.claims?.['custom:tenant_id'],
  });

  try {
    // Extract user ID from JWT claims
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    
    // Create chat using unified repository
    // The repository will:
    // 1. Extract tenant ID from JWT
    // 2. Get/cache STS credentials for the tenant
    // 3. Create DynamoDB client with those credentials
    // 4. Access only the tenant's table (IAM enforced)
    const chat = await createChat(userId, event);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        chat,
      }),
    };
  } catch (error: any) {
    console.error('Error creating chat:', error);
    
    // Handle specific error types
    if (error.name === 'AccessDeniedException') {
      // This means the user tried to access resources outside their tenant
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Access denied to tenant resources',
        }),
      };
    }
    
    if (error.message?.includes('No authorization token')) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Authorization required',
        }),
      };
    }
    
    // Generic error
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Internal Server Error',
        // In production, don't expose error details
        ...(process.env.NODE_ENV === 'development' && { error: error.message }),
      }),
    };
  }
};