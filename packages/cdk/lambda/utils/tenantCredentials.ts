import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
  Credentials,
} from '@aws-sdk/client-cognito-identity';

// Maximum retries for Cognito Identity operations
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // milliseconds

/**
 * Get credentials using Cognito Identity Pool Enhanced Flow
 * This enables proper Principal Tag mapping for ABAC-based tenant isolation
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {
  // Extract JWT token from Authorization header
  const authHeader =
    event.headers['X-Original-Authorization'] ||
    event.headers['x-original-authorization'] ||
    event.headers.Authorization ||
    event.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization token found');
  }

  const idToken = authHeader.substring(7);

  // Extract region and identity pool ID from environment
  const region = process.env.AWS_REGION || 'us-east-1';
  const identityPoolId = process.env.IDENTITY_POOL_ID;
  const userPoolId = process.env.USER_POOL_ID;

  if (!identityPoolId || !userPoolId) {
    throw new Error(
      'IDENTITY_POOL_ID and USER_POOL_ID environment variables must be set'
    );
  }

  const client = new CognitoIdentityClient({ region });
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Step 1: Get Identity ID from Cognito Identity Pool
      const getIdResponse = await client.send(
        new GetIdCommand({
          IdentityPoolId: identityPoolId,
          Logins: {
            [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
          },
        })
      );

      if (!getIdResponse.IdentityId) {
        throw new Error('Failed to get Identity ID');
      }

      // Step 2: Get credentials for the identity
      // This will include Principal Tags from JWT claims via Role Mapping
      const credentialsResponse = await client.send(
        new GetCredentialsForIdentityCommand({
          IdentityId: getIdResponse.IdentityId,
          Logins: {
            [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken,
          },
        })
      );

      if (!credentialsResponse.Credentials) {
        throw new Error('Failed to get credentials');
      }

      // Return credentials with Principal Tags automatically included
      return credentialsResponse.Credentials;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `GetCredentialsForIdentity attempt ${attempt} failed:`,
        error
      );

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * attempt)
        );
      }
    }
  }

  // All retries failed
  throw new Error(
    `Failed to get credentials after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}