import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { logger } from './utils/logger';

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
    try {
      const model = event.model || defaultModel;
      for await (const token of api[model.type].invokeStream?.(
        model,
        event.messages,
        event.id,
        event.idToken
      ) ?? []) {
        responseStream.write(token);
      }
    } catch (error) {
      logger.error(
        'Error in predictStream',
        {
          modelType: event.model?.type || defaultModel.type,
          messageCount: event.messages?.length || 0,
        },
        error instanceof Error ? error : undefined
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const errorChunk = JSON.stringify({
        text: `エラーが発生しました: ${errorMessage}`,
        stopReason: 'error',
      });
      responseStream.write(errorChunk + '\n');
    } finally {
      responseStream.end();
    }
  }
);
