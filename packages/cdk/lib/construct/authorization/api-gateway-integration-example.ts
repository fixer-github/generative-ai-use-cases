/**
 * API Gateway Integration Example
 * API Gateway統合例
 *
 * This file demonstrates how to integrate the AuthorizationSystem
 * with an existing API Gateway setup.
 *
 * THIS IS AN EXAMPLE - NOT MEANT TO BE IMPORTED DIRECTLY
 */

import { Duration } from 'aws-cdk-lib';
import {
  RestApi,
  LambdaIntegration,
  RequestAuthorizer,
  IdentitySource,
  AuthorizationType,
} from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { AuthorizationSystem } from './authorization-system';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

/**
 * Example: How to integrate Authorization System with API Gateway
 */
export class ApiGatewayWithAuthorizationExample extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Assume these are passed from parent stack
    const userPool: IUserPool = {} as any; // Replace with actual UserPool
    const vpc: IVpc = {} as any; // Replace with actual VPC

    // ========================================================================
    // 1. Create Authorization System
    // ========================================================================
    const authzSystem = new AuthorizationSystem(this, 'AuthorizationSystem', {
      userPool,
      spiceDBEndpoint: 'spicedb.cluster.local:50051', // Your SpiceDB endpoint
      spiceDBToken: 'your-spicedb-token', // Should come from Secrets Manager
      vpc,
      quotaAlertEmail: 'admin@example.com',
      enableCache: true,
      cacheTTLSeconds: 300,
      enableQuotaAlerts: true,
    });

    // ========================================================================
    // 2. Create Lambda Authorizer for API Gateway
    // ========================================================================
    const authorizer = new RequestAuthorizer(this, 'RequestAuthorizer', {
      handler: authzSystem.authorizerFunction,
      identitySources: [IdentitySource.header('Authorization')],
      resultsCacheTtl: Duration.minutes(5), // Cache authorization decisions
      authorizerName: 'SpiceDBAuthorizer',
    });

    // ========================================================================
    // 3. Create API Gateway with Authorizer
    // ========================================================================
    const api = new RestApi(this, 'Api', {
      restApiName: 'GenAI API with Authorization',
      description: 'API with SpiceDB-based authorization',
      defaultMethodOptions: {
        authorizer,
        authorizationType: AuthorizationType.CUSTOM,
      },
    });

    // ========================================================================
    // 4. Create Backend Lambda Functions
    // ========================================================================

    // Example: Chat API Lambda
    const chatLambda = new NodejsFunction(this, 'ChatFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/chat-handler.ts', // Your chat handler
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: {
        // Pass necessary environment variables
      },
    });

    // Grant permission to send usage events
    authzSystem.grantSendUsageEvents(chatLambda);

    // Example: RAG API Lambda
    const ragLambda = new NodejsFunction(this, 'RagFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/rag-handler.ts', // Your RAG handler
      handler: 'handler',
      timeout: Duration.seconds(30),
    });

    authzSystem.grantSendUsageEvents(ragLambda);

    // ========================================================================
    // 5. Add API Resources and Methods
    // ========================================================================

    // Chat endpoint
    const chatResource = api.root.addResource('chat');
    chatResource.addMethod('POST', new LambdaIntegration(chatLambda), {
      authorizer, // Use the SpiceDB authorizer
      authorizationType: AuthorizationType.CUSTOM,
    });

    // RAG endpoint
    const ragResource = api.root.addResource('rag');
    ragResource.addMethod('POST', new LambdaIntegration(ragLambda), {
      authorizer,
      authorizationType: AuthorizationType.CUSTOM,
    });

    // Conversations endpoint (with path parameters)
    const conversationsResource = api.root.addResource('conversations');

    // GET /conversations - list conversations
    conversationsResource.addMethod('GET', new LambdaIntegration(chatLambda), {
      authorizer,
      authorizationType: AuthorizationType.CUSTOM,
    });

    // POST /conversations - create conversation
    conversationsResource.addMethod(
      'POST',
      new LambdaIntegration(chatLambda),
      {
        authorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    // GET /conversations/{id} - get specific conversation
    const conversationResource = conversationsResource.addResource('{id}');
    conversationResource.addMethod('GET', new LambdaIntegration(chatLambda), {
      authorizer,
      authorizationType: AuthorizationType.CUSTOM,
    });

    // DELETE /conversations/{id} - delete conversation
    conversationResource.addMethod(
      'DELETE',
      new LambdaIntegration(chatLambda),
      {
        authorizer,
        authorizationType: AuthorizationType.CUSTOM,
      }
    );

    // Admin endpoints (require tenant admin)
    const adminResource = api.root.addResource('admin');

    const usersResource = adminResource.addResource('users');
    usersResource.addMethod('GET', new LambdaIntegration(chatLambda), {
      authorizer,
      authorizationType: AuthorizationType.CUSTOM,
    });

    usersResource.addMethod('POST', new LambdaIntegration(chatLambda), {
      authorizer,
      authorizationType: AuthorizationType.CUSTOM,
    });
  }
}

/**
 * Example: How to send usage events from backend Lambda
 *
 * Add this to your Lambda function code:
 */
/*
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

async function sendUsageEvent(params: {
  tenantId: string;
  userId: string;
  planId: string;
  resourceType: string;
  resourceId: string;
  model: string;
}) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'genai.usage',
          DetailType: 'UsageEvent',
          Detail: JSON.stringify({
            ...params,
            timestamp: Date.now(),
            eventId: `${params.tenantId}-${params.userId}-${Date.now()}-${Math.random()}`,
          }),
          EventBusName: 'default',
        },
      ],
    })
  );
}

// Usage in handler:
export async function handler(event: any) {
  // Get context from authorizer
  const tenantId = event.requestContext.authorizer.tenantId;
  const userId = event.requestContext.authorizer.userId;
  const planId = event.requestContext.authorizer.planId;

  // Your business logic here
  const response = await processRequest(event);

  // Send usage event
  await sendUsageEvent({
    tenantId,
    userId,
    planId,
    resourceType: 'usecase',
    resourceId: 'chat',
    model: 'claude-3-sonnet',
  });

  return response;
}
*/
