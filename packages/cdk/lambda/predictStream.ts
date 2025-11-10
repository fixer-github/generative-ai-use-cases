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

    // Phase 1: Add timeout to prevent hanging streams
    const STREAMING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const timeoutId = setTimeout(() => {
      console.error('[Streaming Timeout] 5 minutes exceeded');
      responseStream.write(
        JSON.stringify({
          text: '',
          stopReason: 'timeout',
          error: 'Streaming timeout exceeded',
        }) + '\n'
      );
      responseStream.end();
    }, STREAMING_TIMEOUT);

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
      console.error('[Streaming Error]', error);
      responseStream.write(
        JSON.stringify({
          text: '',
          stopReason: 'error',
          error: 'Streaming failed',
        }) + '\n'
      );
    } finally {
      clearTimeout(timeoutId);
      responseStream.end();
    }
  }
);
