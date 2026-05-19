import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PasswordPolicy } from 'generative-ai-use-cases';
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

    const result = await client.send(
      new DescribeUserPoolCommand({
        UserPoolId: USER_POOL_ID,
      })
    );

    const cognitoPolicy = result.UserPool?.Policies?.PasswordPolicy;

    const policy: PasswordPolicy = {
      minimumLength: cognitoPolicy?.MinimumLength ?? 8,
      requireUppercase: cognitoPolicy?.RequireUppercase ?? true,
      requireLowercase: cognitoPolicy?.RequireLowercase ?? false,
      requireNumbers: cognitoPolicy?.RequireNumbers ?? true,
      requireSymbols: cognitoPolicy?.RequireSymbols ?? true,
    };

    return successResponse({ policy });
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
