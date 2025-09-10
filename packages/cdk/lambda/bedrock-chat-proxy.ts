import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const lambdaClient = new LambdaClient({});
const dynamoClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamoClient);

const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const TENANTS_TABLE_NAME = process.env.TENANTS_TABLE_NAME;

/**
 * Extract tenant ID from the authenticated user's context
 * 
 * TODO: Implement proper tenant extraction logic
 * This should extract tenant ID from:
 * 1. Cognito custom attributes (preferred)
 * 2. JWT token claims
 * 3. Request headers
 * 4. Path parameters (if tenant is part of the URL)
 */
async function getTenantIdFromEvent(event: APIGatewayProxyEvent): Promise<string> {
  // FIXME: This is a placeholder implementation
  // Replace with actual tenant extraction logic from Cognito claims
  
  // Example of extracting from authorizer context (Cognito)
  const claims = event.requestContext?.authorizer?.claims;
  if (claims && claims['custom:tenantId']) {
    return claims['custom:tenantId'];
  }

  // Fallback to default tenant for testing
  // TODO: Remove this fallback in production
  console.warn('No tenant ID found in request, using default tenant');
  return 'default';
}

/**
 * Get the Lambda function ARN for a specific tenant's Bedrock Chat function
 * 
 * TODO: Implement one of these strategies:
 * 1. Query DynamoDB Tenants table for Lambda ARN
 * 2. Use SSM Parameter Store with pattern /tenants/{tenantId}/bedrock-chat/lambda-arn
 * 3. Use CloudFormation exports with pattern {tenantId}-BedrockChatLambdaArn
 */
async function getTenantLambdaArn(tenantId: string): Promise<string> {
  // FIXME: This is a placeholder implementation
  // Replace with actual ARN lookup logic
  
  if (TENANTS_TABLE_NAME) {
    try {
      // Option 1: Get from DynamoDB
      const response = await ddbDocClient.send(
        new GetCommand({
          TableName: TENANTS_TABLE_NAME,
          Key: { tenantId },
        })
      );
      
      if (response.Item?.bedrockChatLambdaArn) {
        return response.Item.bedrockChatLambdaArn;
      }
    } catch (error) {
      console.error('Error fetching tenant Lambda ARN from DynamoDB:', error);
    }
  }

  // Option 2: Construct ARN based on naming convention
  // TODO: Replace with actual pattern based on your stack naming
  const functionName = `${ENVIRONMENT}-${tenantId}-TenantBedrockChatStack-HandlerV2`;
  return `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:${functionName}`;
}

/**
 * Transform the API Gateway event for the target Lambda function
 * Adjusts the path to match Bedrock Chat's expected format
 */
function transformEventForTarget(event: APIGatewayProxyEvent): any {
  // Remove 'bedrock-chat' prefix from the path
  const originalPath = event.path;
  const transformedPath = originalPath.replace(/^\/bedrock-chat/, '');
  
  // Handle proxy+ parameter
  const proxy = event.pathParameters?.proxy;
  const transformedProxy = proxy?.replace(/^bedrock-chat\//, '');

  return {
    ...event,
    path: transformedPath || '/',
    pathParameters: {
      ...event.pathParameters,
      proxy: transformedProxy,
    },
    // Add metadata for debugging
    _proxyMetadata: {
      originalPath,
      transformedPath,
      tenantId: null, // Will be set later
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Main handler for proxying requests to tenant-specific Bedrock Chat Lambda functions
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Bedrock Chat Proxy - Incoming request:', {
    path: event.path,
    method: event.httpMethod,
    headers: {
      ...event.headers,
      Authorization: event.headers.Authorization ? '[REDACTED]' : undefined,
    },
  });

  try {
    // Step 1: Extract tenant ID from the request
    const tenantId = await getTenantIdFromEvent(event);
    console.log('Tenant ID:', tenantId);

    // Step 2: Get the target Lambda function ARN
    const targetLambdaArn = await getTenantLambdaArn(tenantId);
    console.log('Target Lambda ARN:', targetLambdaArn);

    // Step 3: Transform the event for the target Lambda
    const transformedEvent = transformEventForTarget(event);
    transformedEvent._proxyMetadata.tenantId = tenantId;

    // Step 4: Invoke the tenant-specific Lambda function
    const invokeCommand = new InvokeCommand({
      FunctionName: targetLambdaArn,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(transformedEvent),
    });

    const invokeResponse = await lambdaClient.send(invokeCommand);
    
    // Step 5: Parse and return the response
    if (invokeResponse.Payload) {
      const payloadString = new TextDecoder().decode(invokeResponse.Payload);
      const response = JSON.parse(payloadString);

      // Check if the Lambda returned an error
      if (invokeResponse.FunctionError) {
        console.error('Lambda invocation error:', response);
        return {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: 'Internal server error',
            message: 'Failed to process request',
            // Include error details in development only
            ...(ENVIRONMENT === 'dev' && { details: response }),
          }),
        };
      }

      // Forward the successful response
      return response;
    }

    // No payload returned
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'No response from target function',
      }),
    };

  } catch (error) {
    console.error('Proxy error:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.name === 'ResourceNotFoundException') {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: 'Not found',
            message: 'Target Lambda function not found',
            ...(ENVIRONMENT === 'dev' && { details: error.message }),
          }),
        };
      }
      
      if (error.name === 'AccessDeniedException') {
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: 'Forbidden',
            message: 'Access denied to target Lambda function',
            ...(ENVIRONMENT === 'dev' && { details: error.message }),
          }),
        };
      }
    }

    // Generic error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to proxy request',
        ...(ENVIRONMENT === 'dev' && { 
          details: error instanceof Error ? error.message : 'Unknown error' 
        }),
      }),
    };
  }
};

/**
 * TODO List for completing the implementation:
 * 
 * 1. Implement getTenantIdFromEvent():
 *    - Extract tenant ID from Cognito custom attributes
 *    - Add validation to ensure tenant ID exists
 *    - Consider caching tenant ID for performance
 * 
 * 2. Implement getTenantLambdaArn():
 *    - Choose strategy: DynamoDB, SSM Parameter Store, or CloudFormation exports
 *    - Add caching mechanism to reduce API calls
 *    - Implement fallback mechanism if primary lookup fails
 * 
 * 3. Add monitoring and metrics:
 *    - CloudWatch custom metrics for proxy latency
 *    - Track tenant-specific invocation counts
 *    - Alert on high error rates
 * 
 * 4. Implement circuit breaker pattern:
 *    - Prevent cascading failures
 *    - Implement retry logic with exponential backoff
 * 
 * 5. Add request/response transformation:
 *    - Handle differences between TypeScript and Python Lambda responses
 *    - Ensure proper error format consistency
 * 
 * 6. Security enhancements:
 *    - Validate tenant access permissions
 *    - Implement rate limiting per tenant
 *    - Add request signing/verification
 * 
 * 7. Performance optimizations:
 *    - Implement connection pooling for SDK clients
 *    - Add response caching where appropriate
 *    - Consider using Lambda extensions for configuration caching
 */