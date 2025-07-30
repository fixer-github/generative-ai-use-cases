import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';
import { verifyToken } from './utils/auth';

const stsClient = new STSClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const token = event.headers['Authorization'];
    if (!token) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Authorization token required',
        }),
      };
    }

    // Verify the token and extract claims
    const payload = await verifyToken(token);
    if (!payload) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Invalid or expired token',
        }),
      };
    }

    // Extract tenant ID from custom claims
    const customClaims = payload['https://aws.amazon.com/tags'] as any;
    const tenantId = customClaims?.principal_tags?.TenantID?.[0];

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Tenant ID not found in token',
        }),
      };
    }

    const userId = payload.sub;
    const sessionName = `tenant-${tenantId}-${userId}`.substring(0, 64); // Max 64 chars

    // Assume role with web identity
    // Note: AssumeRoleWithWebIdentity doesn't support Tags parameter directly
    // The tags are set via the session policy or principal tags in the token
    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
      RoleSessionName: sessionName,
      WebIdentityToken: token,
      DurationSeconds: 3600, // 1 hour
    });

    const response = await stsClient.send(command);

    if (!response.Credentials) {
      throw new Error('Failed to obtain credentials from STS');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        credentials: {
          accessKeyId: response.Credentials.AccessKeyId,
          secretAccessKey: response.Credentials.SecretAccessKey,
          sessionToken: response.Credentials.SessionToken,
          expiration: response.Credentials.Expiration?.toISOString(),
        },
        assumedRoleUser: {
          arn: response.AssumedRoleUser?.Arn,
          assumedRoleId: response.AssumedRoleUser?.AssumedRoleId,
        },
        tenantId,
      }),
    };
  } catch (error) {
    console.error('Error assuming role:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Failed to assume role',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

