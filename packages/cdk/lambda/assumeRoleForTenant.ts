import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';

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

    // Generate a session name (can be any unique identifier)
    // Using timestamp to ensure uniqueness
    const sessionName = `session-${Date.now()}`.substring(0, 64); // Max 64 chars

    // Assume role with web identity
    // Note: Session tags must be configured in the OIDC provider (Cognito) and mapped
    // through the IAM role's trust policy. Direct session tagging via API is not supported
    // with AssumeRoleWithWebIdentity. The tenant ID should be extracted from JWT claims
    // in the Lambda functions instead.
    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: process.env.MULTI_TENANT_ROLE_ARN,
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