import { Handler, Context, APIGatewayProxyEvent } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { buildSummaryContext } from './utils/summaryContext';

declare global {
  namespace awslambda {
    function streamifyResponse(
      f: (
        event: PredictRequest,
        responseStream: NodeJS.WritableStream,
        context: Context
      ) => Promise<void>
    ): Handler;
  }
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const model = event.model || defaultModel;

    // Inject summary context if idToken is available
    let messages = event.messages;
    if (event.idToken) {
      try {
        // Extract userId and tenantId from idToken
        const tokenPayload = JSON.parse(
          Buffer.from(event.idToken.split('.')[1], 'base64').toString()
        );
        const userId = tokenPayload['cognito:username'];
        const tenantId =
          tokenPayload['custom:tenant_id'] ||
          tokenPayload['custom:tenantId'] ||
          '';

        // Create request context for repository functions
        const requestContext = {
          body: null,
          headers: {
            Authorization: event.idToken,
          },
          multiValueHeaders: {},
          httpMethod: 'POST',
          isBase64Encoded: false,
          path: '',
          pathParameters: null,
          queryStringParameters: null,
          multiValueQueryStringParameters: null,
          stageVariables: null,
          resource: '',
          requestContext: {
            accountId: '',
            apiId: '',
            authorizer: {
              claims: {
                'cognito:username': userId,
                'custom:tenant_id': tenantId,
              },
            },
            protocol: 'HTTP/1.1',
            httpMethod: 'POST',
            identity: {
              accessKey: null,
              accountId: null,
              apiKey: null,
              apiKeyId: null,
              caller: null,
              clientCert: null,
              cognitoAuthenticationProvider: null,
              cognitoAuthenticationType: null,
              cognitoIdentityId: null,
              cognitoIdentityPoolId: null,
              principalOrgId: null,
              sourceIp: '',
              user: null,
              userAgent: null,
              userArn: null,
            },
            path: '',
            stage: '',
            requestId: '',
            requestTimeEpoch: 0,
            resourceId: '',
            resourcePath: '',
          },
        } satisfies APIGatewayProxyEvent;

        // Build summary context
        const summaryContext = await buildSummaryContext(userId, requestContext);

        // Inject summary context into system message if available
        if (summaryContext) {
          messages = event.messages.map((msg, index) => {
            if (msg.role === 'system') {
              return {
                ...msg,
                content: `${msg.content}\n\n${summaryContext}`,
              };
            }
            return msg;
          });
        }
      } catch (error) {
        // Continue without summary context if injection fails
        console.error('Failed to inject summary context:', error);
      }
    }

    for await (const token of api[model.type].invokeStream?.(
      model,
      messages,
      event.id,
      event.idToken
    ) ?? []) {
      responseStream.write(token);
    }
    responseStream.end();
  }
);
