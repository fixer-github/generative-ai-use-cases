import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
  Credentials,
} from '@aws-sdk/client-sts';
import * as crypto from 'crypto';

// Maximum retries for STS AssumeRole
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // milliseconds

/**
 * Get credentials using AssumeRoleWithWebIdentity with retry logic
 * The assumed role's IAM policies automatically enforce tenant isolation
 * NOTE: No caching to ensure proper user isolation within tenants
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {

  // Extract tenant ID for session name
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'] || 'default';

  // Extract user ID for better session identification
  const userId =
    event.requestContext?.authorizer?.claims?.['cognito:username'] || 'unknown';

  // Extract JWT token from Authorization header
  // API Gateway passes the original Authorization header as X-Original-Authorization
  const authHeader = event.headers['X-Original-Authorization'] ||
                    event.headers['x-original-authorization'] ||
                    event.headers.Authorization ||
                    event.headers.authorization;


  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization token found');
  }

  const idToken = authHeader.substring(7);

  // Create unique session name with hash to prevent truncation issues
  // Use hash of tenantId+userId to ensure uniqueness within 64-char limit
  const timestamp = Date.now();
  const userHash = crypto
    .createHash('md5')
    .update(tenantId + userId)
    .digest('hex')
    .substring(0, 16);
  const sessionName = `session-${userHash}-${timestamp}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // AssumeRoleWithWebIdentity - session tags come from JWT claims automatically
      // when properly configured in the IAM role trust policy
      const stsClient = new STSClient({});

      const { Credentials } = await stsClient.send(
        new AssumeRoleWithWebIdentityCommand({
          RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
          RoleSessionName: sessionName,
          WebIdentityToken: idToken,
          DurationSeconds: 600, // 10 minutes
        })
      );

      // Return fresh credentials without caching
      return Credentials!;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `AssumeRoleWithWebIdentity attempt ${attempt} failed:`,
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
