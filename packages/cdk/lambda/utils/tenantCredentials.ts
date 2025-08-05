import { APIGatewayProxyEvent } from 'aws-lambda';
import { STSClient, AssumeRoleWithWebIdentityCommand, Credentials } from '@aws-sdk/client-sts';

// Cache for credentials
let cachedCredentials: Credentials | null = null;
let credentialsExpiry: number = 0;

/**
 * Get credentials using AssumeRoleWithWebIdentity
 * The assumed role's IAM policies automatically enforce tenant isolation
 */
export async function getTenantCredentials(
  event: APIGatewayProxyEvent
): Promise<Credentials> {
  // Return cached credentials if still valid
  if (cachedCredentials && Date.now() < credentialsExpiry) {
    return cachedCredentials;
  }

  // Extract JWT token from Authorization header
  const authHeader = event.headers.Authorization || event.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization token found');
  }
  
  const idToken = authHeader.substring(7);

  try {
    // Assume role with web identity
    // The JWT's tenant ID claim is automatically passed as a session tag
    const stsClient = new STSClient({});
    const { Credentials } = await stsClient.send(
      new AssumeRoleWithWebIdentityCommand({
        RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
        RoleSessionName: `session-${Date.now()}`,
        WebIdentityToken: idToken,
        DurationSeconds: 3600,
      })
    );

    if (!Credentials) {
      throw new Error('Failed to obtain credentials');
    }

    // Cache credentials with 5 minute buffer before expiration
    cachedCredentials = Credentials;
    credentialsExpiry = Credentials.Expiration ? 
      Credentials.Expiration.getTime() - 5 * 60 * 1000 : 
      Date.now() + 55 * 60 * 1000;

    return Credentials;
  } catch (error) {
    console.error('AssumeRoleWithWebIdentity failed:', error);
    throw new Error(`Failed to get credentials: ${error}`);
  }
}