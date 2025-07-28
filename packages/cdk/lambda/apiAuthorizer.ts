import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';

// Environment variables
const USER_POOL_ID = process.env.USER_POOL_ID || '';
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID || '';
const TENANT_ROLE_ARN = process.env.TENANT_ROLE_ARN || '';

// JWT verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: USER_POOL_CLIENT_ID,
});

export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  console.log('Request:', JSON.stringify(event, null, 2));

  try {
    // Extract token from Authorization header
    const token = event.headers?.Authorization || event.headers?.authorization || '';
    
    if (!token) {
      throw new Error('No authorization token provided');
    }

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.substring(7) : token;

    // Check if this is an AWS4 signed request (IAM auth)
    if (event.headers?.['X-Amz-Security-Token'] || event.headers?.['x-amz-security-token']) {
      // This is an IAM authenticated request
      // The API Gateway will handle IAM auth validation
      // We just need to extract the principal ID from the request context
      
      // For IAM auth, we trust API Gateway's validation
      // The principalId will be the assumed role session name or IAM user
      return generatePolicy('user', 'Allow', event.methodArn, {
        authType: 'IAM',
      });
    }

    // Otherwise, verify Cognito JWT token
    const payload = await verifier.verify(cleanToken);
    
    // Extract user information
    const userId = payload.sub;
    const email = payload.email as string;
    const tenantId = payload['custom:tenant_id'] as string;

    // Generate policy
    return generatePolicy(userId, 'Allow', event.methodArn, {
      userId,
      email,
      tenantId,
      authType: 'Cognito',
    });

  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized');
  }
};

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, any>
): APIGatewayAuthorizerResult {
  const authResponse: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  // Add context if provided
  if (context) {
    authResponse.context = context;
  }

  return authResponse;
}