import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getTenantId } from './utils/tenantUtils';
import { getTenant } from './tenantManager';
import { getTenantCredentials } from './utils/tenantCredentials';

const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

/**
 * Get the Lambda function ARN for a specific tenant's Bedrock Chat function
 * Uses DynamoDB Tenants table to retrieve the Lambda ARN from metadata field
 */
async function getTenantLambdaArn(tenantId: string): Promise<string> {
  try {
    // Get tenant information from DynamoDB
    const tenant = await getTenant(tenantId);
    
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    
    // Check if Lambda ARN exists in metadata
    const lambdaArn = tenant.metadata?.bedrockChatLambdaArn;
    
    if (lambdaArn) {
      console.log(`Found Bedrock Chat Lambda ARN for tenant ${tenantId}: ${lambdaArn}`);
      return lambdaArn;
    }
    
    // Fallback: Construct ARN based on naming convention if not found in metadata
    // This is temporary until all tenants have their ARNs stored in metadata
    console.warn(`Bedrock Chat Lambda ARN not found in metadata for tenant ${tenantId}, using fallback pattern`);
    const functionName = `${ENVIRONMENT}-${tenantId}-TenantBedrockChatStack-HandlerV2`;
    const fallbackArn = `arn:aws:lambda:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:function:${functionName}`;
    
    console.log(`Using fallback ARN for tenant ${tenantId}: ${fallbackArn}`);
    return fallbackArn;
    
  } catch (error) {
    console.error(`Error fetching tenant Lambda ARN for ${tenantId}:`, error);
    throw new Error(`Failed to get Lambda ARN for tenant ${tenantId}: ${error}`);
  }
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
  _context: Context
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
    const tenantId = getTenantId(event);
    console.log('Tenant ID:', tenantId);

    // Step 2: Get the target Lambda function ARN
    const targetLambdaArn = await getTenantLambdaArn(tenantId);
    console.log('Target Lambda ARN:', targetLambdaArn);

    // Step 3: Get tenant-specific credentials using AssumeRoleWithWebIdentity
    // This ensures that we can only invoke Lambda functions for the authenticated tenant
    const tenantCredentials = await getTenantCredentials(event);
    console.log('Obtained tenant-specific credentials for cross-tenant access prevention');

    // Step 4: Create a new Lambda client with tenant-specific credentials
    // This client can only access resources allowed by the tenant's IAM role
    const lambdaClient = new LambdaClient({
      credentials: {
        accessKeyId: tenantCredentials.AccessKeyId!,
        secretAccessKey: tenantCredentials.SecretAccessKey!,
        sessionToken: tenantCredentials.SessionToken!,
      },
      region: process.env.AWS_REGION,
    });

    // Step 5: Transform the event for the target Lambda
    const transformedEvent = transformEventForTarget(event);
    transformedEvent._proxyMetadata.tenantId = tenantId;

    // Step 6: Invoke the tenant-specific Lambda function with tenant credentials
    const invokeCommand = new InvokeCommand({
      FunctionName: targetLambdaArn,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(transformedEvent),
    });

    const invokeResponse = await lambdaClient.send(invokeCommand);
    
    // Step 7: Parse and return the response
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
 * 1. ✅ COMPLETED: getTenantIdFromEvent() - Using existing getTenantId from utils/tenantUtils
 * 
 * 2. ✅ COMPLETED: getTenantLambdaArn() - Using DynamoDB Tenants table with metadata field
 *    - Implemented DynamoDB strategy using metadata.bedrockChatLambdaArn
 *    - Added fallback mechanism with naming convention if ARN not found in metadata
 *    - TODO: Add caching mechanism to reduce API calls (future optimization)
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