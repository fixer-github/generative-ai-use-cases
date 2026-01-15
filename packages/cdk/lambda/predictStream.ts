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

    // model.typeの検証
    const apiHandler = api[model.type];
    if (!apiHandler) {
      console.error('Unknown model type:', {
        modelType: model.type,
        modelId: model.modelId,
      });
      responseStream.write(
        streamingChunk({
          text: `Unknown model type: ${model.type}. Please select a valid model.`,
          stopReason: 'error',
        })
      );
      responseStream.end();
      return;
    }

    if (!apiHandler.invokeStream) {
      console.error('Streaming not supported:', { modelType: model.type });
      responseStream.write(
        streamingChunk({
          text: 'This model does not support streaming responses.',
          stopReason: 'error',
        })
      );
      responseStream.end();
      return;
    }

    try {
      for await (const token of apiHandler.invokeStream(
        model,
        event.messages,
        event.id,
        event.idToken,
        event.webSearchEnabled
      )) {
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
