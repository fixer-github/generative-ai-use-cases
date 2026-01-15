import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { streamingChunk } from './utils/streamingChunk';

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

    try {
      for await (const token of api[model.type].invokeStream?.(
        model,
        event.messages,
        event.id,
        event.idToken,
        event.webSearchEnabled
      ) ?? []) {
        responseStream.write(token);
      }
    } catch (e) {
      console.error('Unhandled error in predictStream:', e);
      responseStream.write(
        streamingChunk({
          text: 'An unexpected error occurred. Please try again.',
          stopReason: 'error',
        })
      );
    } finally {
      responseStream.end();
    }
  }
);
