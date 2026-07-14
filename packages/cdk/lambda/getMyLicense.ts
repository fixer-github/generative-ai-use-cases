import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetMyLicenseResponse } from 'generative-ai-use-cases';
import { getMyLicenseInfo } from './utils/license';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer!.claims['cognito:username'];
    const license = await getMyLicenseInfo(userId);
    const body: GetMyLicenseResponse = { license };
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    };
  } catch (error) {
    console.error('Error getting license info:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
