import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';

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
        });
        responseStream.write(errorMessage);
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

      // Increment usage count after successful streaming (fire-and-forget)
      if (accessCheckResult.limitType === 'limited') {
        incrementUsage(
          event.idToken,
          'llm',
          model.modelId,
          accessCheckResult.limitType
        ).catch((error) => {
          console.error('Failed to increment usage count:', error);
        });
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
    const model = event.model || defaultModel;
    for await (const token of api[model.type].invokeStream?.(
      model,
      event.messages,
      event.id,
      event.idToken
    ) ?? []) {
      responseStream.write(token);
    }
    responseStream.end();
  }
);
