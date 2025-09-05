import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
  Credentials,
} from '@aws-sdk/client-sts';

// Maximum retries for AssumeRole operations
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // milliseconds

/**
 * Assume role using JWT token from Cognito User Pool via AssumeRoleWithWebIdentity
 * This is the new authentication flow for Phase 1 that replaces Identity Pool GetCredentialsForIdentity
 */
export async function assumeRoleWithWebIdentity(
  event: APIGatewayProxyEvent,
  roleArn: string
): Promise<Credentials> {

  // Extract tenant ID for logging and session naming
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'] || 'default';

  // Extract user ID for logging and session naming
  const userId =
    event.requestContext?.authorizer?.claims?.['cognito:username'] || 'unknown';

  // Extract JWT token from Authorization header
  const idToken = event.headers.Authorization || event.headers.authorization;
  if (!idToken) {
    throw new Error('No valid authorization token found');
  }

  console.log(
    `AssumeRoleWithWebIdentity for tenant: ${tenantId}, user: ${userId}, role: ${roleArn}`
  );

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stsClient = new STSClient({ region: process.env.AWS_REGION! });

      // Create unique session name for better traceability
      const sessionName = `TenantSession-${tenantId}-${userId}-${Date.now()}`;

      console.log(`Attempting AssumeRoleWithWebIdentity, attempt ${attempt}`);

      const assumeRoleResponse = await stsClient.send(
        new AssumeRoleWithWebIdentityCommand({
          RoleArn: roleArn,
          WebIdentityToken: idToken,
          RoleSessionName: sessionName,
          DurationSeconds: 3600, // 1 hour session
        })
      );

      if (!assumeRoleResponse.Credentials) {
        throw new Error(
          `Failed to assume role with web identity. Response: ${JSON.stringify(assumeRoleResponse)}`
        );
      }

      console.log(
        `Successfully assumed role for tenant: ${tenantId}, user: ${userId}`
      );

      return assumeRoleResponse.Credentials;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `AssumeRoleWithWebIdentity attempt ${attempt} failed for tenant: ${tenantId}, user: ${userId}:`,
        {
          error: error,
          errorMessage: (error as Error).message,
          roleArn: roleArn,
          region: process.env.AWS_REGION!,
        }
      );

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        console.log(`Retrying in ${RETRY_DELAY * attempt}ms...`);
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * attempt)
        );
      }
    }
  }

  // All retries failed
  throw new Error(
    `Failed to assume role after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

/**
 * Build tenant-specific role ARN for same account (Phase 1)
 * In Phase 2, this will be replaced with cross-account role ARNs from tenant metadata
 */
export function buildTenantRoleArn(
  accountId: string,
  region: string,
  tenantId: string
): string {
  return `arn:aws:iam::${accountId}:role/TenantRole-${tenantId}`;
}

/**
 * Extract tenant ID from API Gateway event claims
 */
export function extractTenantId(event: APIGatewayProxyEvent): string {
  const tenantId =
    event.requestContext?.authorizer?.claims?.['custom:tenant_id'];
  
  if (!tenantId) {
    throw new Error('Tenant ID not found in JWT claims');
  }
  
  return tenantId;
}