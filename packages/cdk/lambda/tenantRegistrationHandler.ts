import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { TenantStatus } from './tenantManager';
import {
  badRequest400Response,
  internalServerError500Response,
  ok200Response,
  serviceUnavailable503Response,
  tooManyRequests429Response,
} from './utils/apiResponse';

// Environment variables with validation
const TENANTS_TABLE_NAME = (() => {
  const tableName = process.env.TENANTS_TABLE_NAME;
  if (!tableName) {
    throw new Error(
      '[CRITICAL] TENANTS_TABLE_NAME environment variable is required'
    );
  }
  return tableName;
})();

const AWS_REGION = (() => {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('[CRITICAL] AWS_REGION environment variable is required');
  }
  return region;
})();

// DynamoDB client
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });

// Request interface
interface TenantRegistrationRequest {
  tenantId: string;
  accountId: string;
  region: string;
  environment: string;
  roleArn?: string;
  controlPlaneLambdaRoleArn?: string;
  openSearchDomainArn?: string;
  openSearchEndpoint?: string;
  openSearchIndexName?: string;
}

/**
 * API Gateway handler for tenant registration
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Declare request outside try block for error context
  let parsedRequest: TenantRegistrationRequest | undefined;

  try {
    // Parse and validate request
    if (!event.body) {
      return badRequest400Response({
        message: 'Request body is required',
        error: 'Request body is required',
      });
    }

    try {
      parsedRequest = JSON.parse(event.body);
    } catch (parseError) {
      console.warn('[WARN] Malformed JSON in request body', {
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
        awsRequestId: context.awsRequestId,
      });
      return badRequest400Response({
        message: 'Invalid JSON in request body',
        error: 'Request body must be valid JSON',
      });
    }

    // At this point parsedRequest is guaranteed to be defined (JSON.parse succeeded)
    const request = parsedRequest as TenantRegistrationRequest;
    const {
      tenantId,
      accountId,
      region,
      environment,
      roleArn,
      controlPlaneLambdaRoleArn,
      openSearchDomainArn,
      openSearchEndpoint,
      openSearchIndexName,
    } = request;

    // Log request without sensitive data
    console.log('[INFO] Tenant registration request received', {
      tenantId,
      region,
      environment,
      hasOpenSearchConfig: !!(
        openSearchDomainArn ||
        openSearchEndpoint ||
        openSearchIndexName
      ),
    });

    // Validate required fields
    if (!tenantId || !accountId || !region || !environment) {
      return badRequest400Response({
        message:
          'Missing required fields: tenantId, accountId, region, environment',
        error:
          'Missing required fields: tenantId, accountId, region, environment',
      });
    }

    // Validate OpenSearch configuration - all three fields must be provided together
    const hasOpenSearchConfig = !!(
      openSearchDomainArn?.trim() ||
      openSearchEndpoint?.trim() ||
      openSearchIndexName?.trim()
    );

    if (hasOpenSearchConfig) {
      // All three must be provided and non-empty
      if (
        !openSearchDomainArn?.trim() ||
        !openSearchEndpoint?.trim() ||
        !openSearchIndexName?.trim()
      ) {
        return badRequest400Response({
          message:
            'All OpenSearch fields (domainArn, endpoint, indexName) must be provided together',
        });
      }

      // Validate endpoint is HTTPS and from amazonaws.com
      if (
        !openSearchEndpoint.startsWith('https://') ||
        !openSearchEndpoint.includes('.amazonaws.com')
      ) {
        return badRequest400Response({
          message:
            'OpenSearch endpoint must be an HTTPS URL from amazonaws.com domain',
        });
      }

      // Validate that endpoint region matches ARN region
      const arnMatch = openSearchDomainArn.match(/arn:aws:es:([^:]+):/);
      const endpointMatch = openSearchEndpoint.match(
        /\.([^.]+)\.es\.amazonaws\.com/
      );

      if (arnMatch && endpointMatch && arnMatch[1] !== endpointMatch[1]) {
        return badRequest400Response({
          message: 'OpenSearch endpoint region must match domain ARN region',
        });
      }
    }

    // UPSERT tenant record using UpdateItem
    // - Always update: accountId, region, environment, roleArn, controlPlaneLambdaRoleArn, updatedAt
    // - Only set if not exists: createdAt, status, metadata, useCaseConfiguration
    // - OpenSearch config: only update if provided in request
    const now = new Date().toISOString();

    // Build UpdateExpression dynamically based on OpenSearch config
    let updateExpression = `
      SET accountId = :accountId,
          #region = :region,
          environment = :environment,
          roleArn = :roleArn,
          controlPlaneLambdaRoleArn = :controlPlaneLambdaRoleArn,
          updatedAt = :updatedAt,
          createdAt = if_not_exists(createdAt, :createdAt),
          #status = if_not_exists(#status, :status),
          metadata = if_not_exists(metadata, :metadata),
          useCaseConfiguration = if_not_exists(useCaseConfiguration, :useCaseConfiguration)
    `;

    const expressionAttributeNames: Record<string, string> = {
      '#region': 'region',
      '#status': 'status',
    };

    const expressionAttributeValues: Record<string, any> = {
      ':accountId': accountId,
      ':region': region,
      ':environment': environment,
      ':roleArn': roleArn ?? null,
      ':controlPlaneLambdaRoleArn': controlPlaneLambdaRoleArn ?? null,
      ':updatedAt': now,
      ':createdAt': now,
      ':status': TenantStatus.PROVISIONING,
      ':metadata': {
        source: 'api-registration',
        registeredVia: 'tenant-stack',
      },
      ':useCaseConfiguration': {
        hiddenUseCases: {},
        updatedAt: now,
        updatedBy: 'system',
      },
    };

    // Add OpenSearch configuration to UpdateExpression if provided
    if (hasOpenSearchConfig) {
      updateExpression += `,
          openSearchDomainArn = :openSearchDomainArn,
          openSearchEndpoint = :openSearchEndpoint,
          openSearchIndexName = :openSearchIndexName
      `;
      expressionAttributeValues[':openSearchDomainArn'] = openSearchDomainArn;
      expressionAttributeValues[':openSearchEndpoint'] = openSearchEndpoint;
      expressionAttributeValues[':openSearchIndexName'] = openSearchIndexName;
    }

    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: TENANTS_TABLE_NAME,
        Key: marshall({ tenantId }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
      })
    );

    console.log(`Successfully registered tenant: ${tenantId}`);

    return ok200Response({
      message: 'Tenant registered successfully',
      tenantId,
      status: TenantStatus.PROVISIONING,
    });
  } catch (error) {
    // Build error context for logging
    const errorContext = {
      operation: 'tenantRegistration',
      tenantId: parsedRequest?.tenantId ?? 'unknown',
      region: parsedRequest?.region ?? 'unknown',
      environment: parsedRequest?.environment ?? 'unknown',
      awsRequestId: context.awsRequestId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    };

    console.error('[ERROR] Failed to register tenant:', errorContext);

    // Handle specific DynamoDB errors
    if (error instanceof Error) {
      switch (error.name) {
        case 'ProvisionedThroughputExceededException':
        case 'RequestLimitExceeded':
          return tooManyRequests429Response({
            message:
              'Service is temporarily overloaded. Please retry after a few seconds.',
            error: 'Rate limit exceeded',
          });

        case 'ResourceNotFoundException':
          console.error(
            '[CRITICAL] Tenants table not found - check deployment configuration'
          );
          return internalServerError500Response({
            message: 'Service configuration error. Please contact support.',
            error: 'Resource not found',
          });

        case 'AccessDeniedException':
          console.error('[CRITICAL] IAM permission denied for DynamoDB');
          return internalServerError500Response({
            message: 'Service authorization error. Please contact support.',
            error: 'Access denied',
          });

        case 'ValidationException':
          console.error(
            '[CRITICAL] DynamoDB ValidationException - possible code bug'
          );
          return internalServerError500Response({
            message: 'Internal validation error. Please contact support.',
            error: error.message,
          });

        case 'InternalServerError':
        case 'ServiceUnavailable':
          return serviceUnavailable503Response({
            message:
              'AWS service is temporarily unavailable. Please retry later.',
            error: 'Service unavailable',
          });
      }
    }

    // Generic fallback for unknown errors
    return internalServerError500Response({
      message: 'Failed to register tenant. Please try again or contact support.',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
