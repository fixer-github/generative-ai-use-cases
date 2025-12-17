import { Handler, Context } from 'aws-lambda';
import { PredictRequest, ErrorCode } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  checkAccessWithQuota,
  incrementUsage,
  getLatestUsage,
  AccessCheckResult,
} from './utils/accessChecker';

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

    let accessCheckResult: AccessCheckResult | null = null;

    try {
      const model = event.model || defaultModel;

      // Authorization check: Verify ID token and check LLM access with quota
      if (!event.idToken) {
        const errorMessage = JSON.stringify({
          text: '',
          stopReason: 'error',
          error: {
            code: 'INVALID_TOKEN' as ErrorCode,
            message: 'ID token is required for authorization',
          },
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
        let errorCode: ErrorCode;
        let errorMessage: string;

        switch (accessCheckResult.reason) {
          case 'quota_exceeded':
            console.warn(
              `User ${userId} has exceeded quota for model ${model.modelId}`
            );
            errorCode = 'QUOTA_EXCEEDED';
            errorMessage = `利用回数の上限に達しました: ${model.modelId}`;
            break;
          case 'no_permission':
            console.warn(
              `User ${userId} does not have access to model ${model.modelId}`
            );
            errorCode = 'NO_PERMISSION';
            errorMessage = `このモデルを使用する権限がありません: ${model.modelId}`;
            break;
          case 'invalid_token':
            errorCode = 'INVALID_TOKEN';
            errorMessage = 'Invalid or expired ID token';
            break;
          default:
            errorCode = 'NO_PERMISSION';
            errorMessage = `You do not have permission to use the model: ${model.modelId}`;
        }

        const errorResponse = JSON.stringify({
          text: '',
          stopReason: 'error',
          error: {
            code: errorCode,
            message: errorMessage,
          },
        });
        responseStream.write(errorResponse);
        responseStream.end();
        return;
      }

      // If authorized, proceed with streaming
      for await (const token of api[model.type].invokeStream?.(
        model,
        event.messages,
        event.id,
        event.idToken
      ) ?? []) {
        responseStream.write(token);
      }

      // Increment usage count after successful streaming and return latest usage info
      if (accessCheckResult.limitType && accessCheckResult.limitType !== 'unlimited') {
        try {
          await incrementUsage(
            event.idToken,
            'llm',
            model.modelId,
            accessCheckResult.limitType
          );

          // Get latest usage info after incrementing
          const latestUsage = await getLatestUsage(event.idToken, 'llm', model.modelId);

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

      responseStream.end();
    } catch (error) {
      console.error('PredictStream error:', error);
      const errorResponse = JSON.stringify({
        text: '',
        stopReason: 'error',
        error: {
          code: 'INTERNAL_ERROR' as ErrorCode,
          message: 'Internal Server Error',
        },
      });
      responseStream.write(errorResponse);
      responseStream.end();
    }
  }
);
