import { Handler, Context, APIGatewayProxyEvent } from 'aws-lambda';
import { PredictRequest, UnrecordedMessage } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  checkAccessWithQuota,
  incrementUsage,
  getLatestUsage,
  AccessCheckResult,
} from './utils/accessChecker';
import { buildSummaryContext } from './utils/summaryContext';
import { buildSystemPrompt } from './utils/systemPromptBuilder';

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

/**
 * メッセージ配列から画像ファイルの数をカウントする
 * @param messages メッセージ配列
 * @returns 画像ファイルの数
 */
function countImages(messages: UnrecordedMessage[]): number {
  return messages
    .flatMap((m) => m.extraData ?? [])
    .filter((e) => e.type === 'image').length;
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    let accessCheckResult: AccessCheckResult | null = null;
    let mediaCheckResult: AccessCheckResult | null = null;

    try {
      const model = event.model || defaultModel;

      // Authorization check: Verify ID token and check LLM access with quota
      if (!event.idToken) {
        const errorMessage = JSON.stringify({
          text: 'ID token is required for authorization',
          stopReason: 'error',
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      // Check permission and quota using accessChecker
      accessCheckResult = await checkAccessWithQuota(
        event.idToken,
        'llm',
        model.modelId
      );

      if (!accessCheckResult.allowed) {
        const userId = accessCheckResult.userContext?.userId || 'unknown';
        let errorText: string;

        switch (accessCheckResult.reason) {
          case 'quota_exceeded':
            console.warn(
              `User ${userId} has exceeded quota for model ${model.modelId}`
            );
            errorText = `利用回数の上限に達しました: ${model.modelId}`;
            break;
          case 'no_permission':
            console.warn(
              `User ${userId} does not have access to model ${model.modelId}`
            );
            errorText = `このモデルを使用する権限がありません: ${model.modelId}`;
            break;
          case 'invalid_token':
            errorText = 'Invalid or expired ID token';
            break;
          default:
            errorText = `You do not have permission to use the model: ${model.modelId}`;
        }

        const errorMessage = JSON.stringify({
          text: errorText,
          stopReason: 'error',
          errorReason: accessCheckResult.reason,
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      // Count images in the current user message only (last message)
      // 過去のメッセージに含まれる画像は既にカウント済みなので、今回送信されたメッセージのみをカウント対象とする
      const lastMessage = event.messages[event.messages.length - 1];
      const imageCount = lastMessage ? countImages([lastMessage]) : 0;

      // Check image input limit if there are images
      if (imageCount > 0) {
        mediaCheckResult = await checkAccessWithQuota(
          event.idToken,
          'prompt-media',
          'image',
          imageCount
        );

        if (!mediaCheckResult.allowed) {
          const userId = mediaCheckResult.userContext?.userId || 'unknown';
          console.warn(
            `User ${userId} has exceeded image input limit - requested: ${imageCount}`
          );

          const errorMessage = JSON.stringify({
            text: `画像入力の利用回数上限に達しました（リクエスト: ${imageCount}枚）`,
            stopReason: 'error',
            errorReason: 'media_limit_exceeded',
          });
          responseStream.write(errorMessage);
          responseStream.end();
          return;
        }
      }

      // Inject summary context if idToken is available
      let messages = event.messages;
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

        // Build system prompt from params if provided (hides prompt from frontend)
        if (event.systemContextParams) {
          const systemPrompt = await buildSystemPrompt(event.systemContextParams);
          const systemContent = summaryContext
            ? `${systemPrompt}\n\n${summaryContext}`
            : systemPrompt;

          messages = [
            { role: 'system' as const, content: systemContent },
            ...event.messages.filter((m) => m.role !== 'system'),
          ];
        } else if (summaryContext) {
          // Backward compatibility: inject summary context into existing system message
          messages = event.messages.map((msg) => {
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

      // If authorized, proceed with streaming
      for await (const token of api[model.type].invokeStream?.(
        model,
        messages,
        event.id,
        event.idToken
      ) ?? []) {
        responseStream.write(token);
      }

      // Increment usage count after successful streaming and return latest usage info
      if (
        accessCheckResult.limitType &&
        accessCheckResult.limitType !== 'unlimited'
      ) {
        try {
          await incrementUsage(
            event.idToken,
            'llm',
            model.modelId,
            accessCheckResult.limitType
          );

          // Get latest usage info after incrementing
          const latestUsage = await getLatestUsage(
            event.idToken,
            'llm',
            model.modelId
          );

          // Send final chunk with updated usage info
          if (latestUsage) {
            responseStream.write(
              JSON.stringify({
                text: '',
                usage: latestUsage,
              })
            );
          }
        } catch (error) {
          console.error('Failed to increment usage count:', error);
        }
      }

      // Increment image usage count after successful streaming
      if (
        mediaCheckResult &&
        mediaCheckResult.limitType &&
        mediaCheckResult.limitType !== 'unlimited'
      ) {
        // チェック時と同じく、最後のメッセージのみを対象とする
        const lastMsg = event.messages[event.messages.length - 1];
        const imgCount = lastMsg ? countImages([lastMsg]) : 0;
        try {
          await incrementUsage(
            event.idToken,
            'prompt-media',
            'image',
            mediaCheckResult.limitType,
            imgCount
          );
          console.log(
            `[PredictStream] Image usage incremented - count: ${imgCount}`
          );
        } catch (error) {
          console.error('Failed to increment image usage count:', error);
        }
      }

      responseStream.end();
    } catch (error) {
      console.error('PredictStream error:', error);
      const errorMessage = JSON.stringify({
        text: 'Internal Server Error',
        stopReason: 'error',
      });
      responseStream.write(errorMessage);
      responseStream.end();
    }
  }
);
