# Multi-Tenant STS Implementation Guide

## Overview

This document outlines the implementation steps for integrating STS (Security Token Service) with the multi-tenant IAM role to enable dynamic, tenant-isolated resource access.

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Cognito   │────▶│  Lambda     │────▶│     STS     │
│             │     │  User Pool  │     │  Function   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                     │                    │
                           ▼                     ▼                    ▼
                    ┌─────────────┐      ┌─────────────┐     ┌─────────────┐
                    │  ID Token   │      │   Extract   │     │  Temporary  │
                    │ with Tenant │      │  Tenant ID  │     │ Credentials │
                    │     ID       │      │   & Call    │     │ with Tenant │
                    └─────────────┘      │     STS     │     │    Tags     │
                                        └─────────────┘     └─────────────┘
```

## Implementation Steps

### 1. Create STS Lambda Function

Create a Lambda function that handles AssumeRoleWithWebIdentity operations:

```typescript
// packages/cdk/lambda/assumeRoleWithTenant.ts
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyToken } from './utils/auth';

const stsClient = new STSClient({});
const MULTI_TENANT_ROLE_ARN = process.env.MULTI_TENANT_ROLE_ARN!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Extract the ID token from Authorization header
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({
          error: 'Missing or invalid authorization header',
        }),
      };
    }

    const idToken = authHeader.substring(7);

    // Verify and decode the token using existing utility
    const payload = await verifyToken(idToken);
    if (!payload) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ error: 'Invalid token' }),
      };
    }

    const tenantId = payload['custom:tenant_id'];
    if (!tenantId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ error: 'No tenant ID found in token' }),
      };
    }

    // Assume role with web identity and session tags
    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: MULTI_TENANT_ROLE_ARN,
      RoleSessionName: `tenant-${tenantId}-${payload.sub}-${Date.now()}`,
      WebIdentityToken: idToken,
      DurationSeconds: 3600, // 1 hour
      Tags: [
        {
          Key: 'TenantID',
          Value: tenantId,
        },
      ],
    });

    const response = await stsClient.send(command);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        credentials: {
          accessKeyId: response.Credentials!.AccessKeyId,
          secretAccessKey: response.Credentials!.SecretAccessKey,
          sessionToken: response.Credentials!.SessionToken,
          expiration: response.Credentials!.Expiration,
        },
        tenantId,
      }),
    };
  } catch (error) {
    console.error('Error assuming role:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({ error: 'Failed to assume role' }),
    };
  }
};
```

### 2. Add Lambda to API Gateway

Update the API construct to include the new Lambda function:

```typescript
// packages/cdk/lib/construct/api.ts (additions)

// Add to BackendApiProps interface:
export interface BackendApiProps {
  // ... existing props ...
  readonly multiTenantRoleArn?: string; // Add this
}

// In the Api construct class, add the Lambda function:
if (props.multiTenantRoleArn) {
  const assumeRoleWithTenantFunction = new NodejsFunction(
    this,
    'AssumeRoleWithTenant',
    {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/assumeRoleWithTenant.ts',
      timeout: Duration.minutes(1),
      environment: {
        MULTI_TENANT_ROLE_ARN: props.multiTenantRoleArn,
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
      },
    }
  );

  // Grant the Lambda permission to assume the multi-tenant role
  assumeRoleWithTenantFunction.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sts:AssumeRoleWithWebIdentity'],
      resources: [props.multiTenantRoleArn],
    })
  );

  // Add API endpoint
  const authResource = this.api.root.addResource('auth');
  const stsResource = authResource.addResource('sts');
  stsResource.addMethod(
    'POST',
    new LambdaIntegration(assumeRoleWithTenantFunction),
    {
      authorizer: this.authorizer,
      authorizationType: AuthorizationType.COGNITO_USER_POOLS,
    }
  );
}
```

Then update the main stack to pass the role ARN:

```typescript
// packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts (in API creation)
const api = new Api(this, 'API', {
  // ... existing props ...
  multiTenantRoleArn: multiTenantRole.role.roleArn, // Add this
});
```

### 3. Frontend Integration

Update the frontend to request and use temporary credentials:

```typescript
// packages/web/src/hooks/useMultiTenantAuth.ts
import { useAuth } from './useAuth';
import { useState, useEffect, useCallback } from 'react';
import { useAuthenticatedUser } from './useAuthenticatedUser';

interface TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

interface STSResponse {
  credentials: TemporaryCredentials;
  tenantId: string;
}

export const useMultiTenantAuth = () => {
  const { getIdToken } = useAuth();
  const { data: user } = useAuthenticatedUser();
  const [credentials, setCredentials] = useState<TemporaryCredentials | null>(
    null
  );
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCredentials = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const idToken = await getIdToken();
      const apiEndpoint = import.meta.env.VITE_APP_API_ENDPOINT;

      const response = await fetch(`${apiEndpoint}/auth/sts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || 'Failed to get temporary credentials'
        );
      }

      const data: STSResponse = await response.json();
      setCredentials(data.credentials);
      setTenantId(data.tenantId);

      // Store in session storage for persistence across page reloads
      sessionStorage.setItem('multiTenantCredentials', JSON.stringify(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Failed to refresh credentials:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, getIdToken]);

  // Load credentials from session storage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('multiTenantCredentials');
    if (stored) {
      try {
        const data: STSResponse = JSON.parse(stored);
        const expiration = new Date(data.credentials.expiration);

        // Check if credentials are still valid
        if (expiration > new Date()) {
          setCredentials(data.credentials);
          setTenantId(data.tenantId);
        } else {
          sessionStorage.removeItem('multiTenantCredentials');
        }
      } catch (err) {
        console.error('Failed to parse stored credentials:', err);
      }
    }
  }, []);

  // Auto-refresh credentials before expiration
  useEffect(() => {
    if (credentials) {
      const expiration = new Date(credentials.expiration);
      const refreshTime = expiration.getTime() - Date.now() - 5 * 60 * 1000; // 5 minutes before expiration

      if (refreshTime > 0) {
        const timer = setTimeout(refreshCredentials, refreshTime);
        return () => clearTimeout(timer);
      } else {
        // Credentials already expired, refresh immediately
        refreshCredentials();
      }
    }
  }, [credentials, refreshCredentials]);

  // Helper function to create AWS SDK v3 credentials
  const getAwsCredentials = useCallback(() => {
    if (!credentials) return null;

    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  }, [credentials]);

  return {
    credentials,
    tenantId,
    refreshCredentials,
    getAwsCredentials,
    isLoading,
    error,
  };
};
```

Also create a context provider for easy access:

```typescript
// packages/web/src/contexts/MultiTenantContext.tsx
import React, { createContext, useContext, ReactNode } from 'react';
import { useMultiTenantAuth } from '../hooks/useMultiTenantAuth';

interface MultiTenantContextType {
  credentials: any;
  tenantId: string | null;
  refreshCredentials: () => Promise<void>;
  getAwsCredentials: () => any;
  isLoading: boolean;
  error: string | null;
}

const MultiTenantContext = createContext<MultiTenantContextType | undefined>(undefined);

export const MultiTenantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const multiTenantAuth = useMultiTenantAuth();

  return (
    <MultiTenantContext.Provider value={multiTenantAuth}>
      {children}
    </MultiTenantContext.Provider>
  );
};

export const useMultiTenant = () => {
  const context = useContext(MultiTenantContext);
  if (!context) {
    throw new Error('useMultiTenant must be used within MultiTenantProvider');
  }
  return context;
};
```

### 4. Create Tenant-Specific Resources

Add a construct for creating tenant-specific DynamoDB tables:

```typescript
// packages/cdk/lib/construct/tenant-resources.ts
import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface TenantResourcesProps {
  readonly tenantId: string;
  readonly resourcePrefix: string;
}

export class TenantResources extends Construct {
  readonly chatTable: Table;
  readonly filesTable: Table;

  constructor(scope: Construct, id: string, props: TenantResourcesProps) {
    super(scope, id);

    // Create tenant-specific chat table
    this.chatTable = new Table(this, 'ChatTable', {
      tableName: `${props.resourcePrefix}-chat-tenant-${props.tenantId}`,
      partitionKey: {
        name: 'userId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'chatId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create tenant-specific files table
    this.filesTable = new Table(this, 'FilesTable', {
      tableName: `${props.resourcePrefix}-files-tenant-${props.tenantId}`,
      partitionKey: {
        name: 'fileId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Add any other tenant-specific resources here
  }
}
```

### 5. Update Lambda Functions to Use Tenant Context

Modify existing Lambda functions to work with tenant-specific resources:

```typescript
// packages/cdk/lambda/utils/tenantContext.ts
import { APIGatewayProxyEvent } from 'aws-lambda';
import { verifyToken } from './auth';

export interface TenantContext {
  tenantId: string;
  userId: string;
  email: string;
}

export const extractTenantContext = async (
  event: APIGatewayProxyEvent
): Promise<TenantContext> => {
  const authHeader = event.headers.Authorization || event.headers.authorization;
  if (!authHeader) {
    throw new Error('No authorization header');
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyToken(token);

  if (!payload) {
    throw new Error('Invalid token');
  }

  const tenantId = payload['custom:tenant_id'];
  if (!tenantId) {
    throw new Error('No tenant ID in token');
  }

  return {
    tenantId,
    userId: payload.sub,
    email: payload.email || '',
  };
};

export const getTenantTableName = (
  baseTableName: string,
  tenantId: string
): string => {
  return `${baseTableName}-tenant-${tenantId}`;
};

export const getTenantBucketName = (
  baseBucketName: string,
  tenantId: string
): string => {
  return `${baseBucketName}-tenant-${tenantId}`;
};
```

Example of updating an existing Lambda:

```typescript
// packages/cdk/lambda/listChats.ts (modified)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  extractTenantContext,
  getTenantTableName,
} from './utils/tenantContext';
import { createSuccessResponse, createErrorResponse } from './utils/api';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { tenantId, userId } = await extractTenantContext(event);
    const tableName = getTenantTableName(process.env.TABLE_NAME!, tenantId);

    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false, // Latest chats first
    });

    const response = await docClient.send(command);

    return createSuccessResponse({
      chats: response.Items || [],
      tenantId,
    });
  } catch (error) {
    console.error('Error listing chats:', error);

    if (error instanceof Error && error.message.includes('No tenant ID')) {
      return createErrorResponse(400, 'Tenant ID not found in token');
    }

    return createErrorResponse(500, 'Failed to list chats');
  }
};
```

### 6. Tenant Provisioning Automation

Create a Lambda for automatic tenant provisioning:

```typescript
// packages/cdk/lambda/provisionTenant.ts
import {
  CloudFormationClient,
  CreateStackCommand,
} from '@aws-sdk/client-cloudformation';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const cfnClient = new CloudFormationClient({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { tenantId, tenantName } = body;

    if (!tenantId || !tenantName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tenantId or tenantName' }),
      };
    }

    // Create CloudFormation stack for tenant resources
    const command = new CreateStackCommand({
      StackName: `tenant-resources-${tenantId}`,
      TemplateBody: JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Description: `Resources for tenant ${tenantId}`,
        Resources: {
          ChatTable: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: `genai-chat-tenant-${tenantId}`,
              AttributeDefinitions: [
                { AttributeName: 'userId', AttributeType: 'S' },
                { AttributeName: 'chatId', AttributeType: 'S' },
              ],
              KeySchema: [
                { AttributeName: 'userId', KeyType: 'HASH' },
                { AttributeName: 'chatId', KeyType: 'RANGE' },
              ],
              BillingMode: 'PAY_PER_REQUEST',
            },
          },
          FilesBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: `genai-files-tenant-${tenantId}`,
              PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
              },
            },
          },
        },
      }),
      Tags: [
        { Key: 'TenantID', Value: tenantId },
        { Key: 'TenantName', Value: tenantName },
      ],
    });

    await cfnClient.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Tenant provisioning initiated',
        tenantId,
        stackName: `tenant-resources-${tenantId}`,
      }),
    };
  } catch (error) {
    console.error('Error provisioning tenant:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to provision tenant' }),
    };
  }
};
```

## Testing Strategy

### 1. Unit Tests

```typescript
// packages/cdk/test/lambda/assumeRoleWithTenant.test.ts
import { handler } from '../../lambda/assumeRoleWithTenant';
import { STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';

const stsMock = mockClient(STSClient);

describe('AssumeRoleWithTenant', () => {
  beforeEach(() => {
    stsMock.reset();
  });

  it('should return temporary credentials for valid tenant', async () => {
    const mockCredentials = {
      AccessKeyId: 'mock-access-key',
      SecretAccessKey: 'mock-secret-key',
      SessionToken: 'mock-session-token',
      Expiration: new Date(Date.now() + 3600000),
    };

    stsMock.resolves({
      Credentials: mockCredentials,
    });

    const event = {
      headers: {
        Authorization: 'Bearer mock-jwt-token',
      },
    };

    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.credentials).toBeDefined();
    expect(body.tenantId).toBeDefined();
  });
});
```

### 2. Integration Tests

```typescript
// packages/cdk/test/integration/multiTenant.test.ts
describe('Multi-tenant Integration', () => {
  it('should isolate resources between tenants', async () => {
    // Test that tenant A cannot access tenant B's resources
    const tenantACredentials = await getCredentialsForTenant('tenant-a');
    const tenantBCredentials = await getCredentialsForTenant('tenant-b');

    // Configure DynamoDB clients
    const dynamoA = new DynamoDBClient({ credentials: tenantACredentials });
    const dynamoB = new DynamoDBClient({ credentials: tenantBCredentials });

    // Tenant A should be able to read from their table
    await expect(
      dynamoA.send(
        new GetItemCommand({
          TableName: 'chat-tenant-a',
          Key: { userId: { S: 'test' } },
        })
      )
    ).resolves.toBeDefined();

    // Tenant A should NOT be able to read from tenant B's table
    await expect(
      dynamoA.send(
        new GetItemCommand({
          TableName: 'chat-tenant-b',
          Key: { userId: { S: 'test' } },
        })
      )
    ).rejects.toThrow('AccessDeniedException');
  });
});
```

## Security Considerations

1. **Token Validation**: Always validate JWT tokens in production
2. **Role Session Duration**: Keep sessions short (1-2 hours max)
3. **Audit Logging**: Enable CloudTrail for all STS AssumeRole calls
4. **Least Privilege**: Only grant minimum required permissions
5. **Resource Naming**: Enforce strict naming conventions
6. **Cross-Tenant Access**: Regularly audit for any cross-tenant access attempts

## Monitoring and Observability

1. **CloudWatch Metrics**:

   - STS AssumeRole success/failure rates
   - Token refresh patterns
   - Per-tenant resource usage

2. **Alarms**:

   - Failed authentication attempts
   - Cross-tenant access attempts
   - Unusual activity patterns

3. **Dashboards**:
   - Tenant activity overview
   - Resource utilization per tenant
   - Authentication metrics

## Migration Guide

For existing applications migrating to multi-tenant architecture:

### Phase 1: Deploy Infrastructure

1. Deploy the multi-tenant role (already done)
2. Add STS Lambda function and API endpoint
3. Update frontend with multi-tenant hooks

### Phase 2: Add Tenant ID to Users

```sql
-- Example: Add tenant_id to existing users
UPDATE cognito_users
SET custom:tenant_id = 'default-tenant'
WHERE custom:tenant_id IS NULL;
```

### Phase 3: Provision Tenant Resources

```bash
# Script to provision resources for existing tenants
aws cloudformation create-stack \
  --stack-name tenant-resources-${TENANT_ID} \
  --template-body file://tenant-resources.yaml \
  --parameters ParameterKey=TenantId,ParameterValue=${TENANT_ID}
```

### Phase 4: Data Migration

```typescript
// Example migration script
const migrateDataToTenantTables = async (tenantId: string) => {
  // Read from shared table
  const sharedData = await readFromSharedTable();

  // Write to tenant-specific table
  const tenantTable = `chat-tenant-${tenantId}`;
  await writeToTenantTable(tenantTable, sharedData);
};
```

### Phase 5: Update Lambda Functions

- Add feature flag for multi-tenant mode
- Gradually enable for specific tenants
- Monitor and rollback if needed

## Environment Variables and Configuration

### Lambda Environment Variables

```typescript
// For STS Lambda
MULTI_TENANT_ROLE_ARN: string; // ARN of the multi-tenant role
USER_POOL_ID: string; // Cognito User Pool ID
USER_POOL_CLIENT_ID: string; // Cognito Client ID

// For application Lambdas
TABLE_NAME: string; // Base table name (without tenant suffix)
BUCKET_NAME: string; // Base bucket name (without tenant suffix)
MULTI_TENANT_MODE: 'true' | 'false'; // Feature flag
```

### Frontend Environment Variables

```typescript
// .env file
VITE_APP_API_ENDPOINT=https://api.example.com
VITE_APP_MULTI_TENANT_ENABLED=true
VITE_APP_AWS_REGION=us-east-1
```

### CDK Context Variables

```json
// cdk.json
{
  "context": {
    "multiTenantEnabled": true,
    "defaultTenantId": "default",
    "tenantResourcePrefix": "genai"
  }
}
```

## Troubleshooting

Common issues and solutions:

1. **"AccessDenied" when assuming role**:

   - Check trust policy on the multi-tenant role
   - Verify JWT token contains tenant_id claim
   - Ensure OIDC provider is correctly configured
   - Check CloudTrail logs for detailed error

2. **"ResourceNotFound" errors**:

   - Verify tenant resources are provisioned
   - Check resource naming matches expected pattern
   - Ensure credentials have correct tenant tag
   - Verify table/bucket exists in correct region

3. **Token expiration issues**:

   - Implement automatic token refresh
   - Monitor token expiration times
   - Consider adjusting session duration
   - Check clock skew between client and server

4. **CORS errors**:
   - Ensure Lambda responses include CORS headers
   - Check API Gateway CORS configuration
   - Verify frontend is sending proper headers

## Quick Start Checklist

- [ ] Deploy multi-tenant role (completed)
- [ ] Create STS Lambda function
- [ ] Add API endpoint for STS
- [ ] Update frontend with multi-tenant hooks
- [ ] Add tenant_id to test users
- [ ] Provision test tenant resources
- [ ] Update one Lambda as proof of concept
- [ ] Test end-to-end flow
- [ ] Plan rollout strategy
