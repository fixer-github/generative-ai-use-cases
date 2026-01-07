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
    const model = event.model || defaultModel;

    // デバッグログ
    console.log('[PredictStream] webSearchEnabled:', event.webSearchEnabled);
    console.log('[PredictStream] SEARCH_API_KEY set:', !!process.env.SEARCH_API_KEY);
    console.log('[PredictStream] SEARCH_ENGINE:', process.env.SEARCH_ENGINE);

    for await (const token of api[model.type].invokeStream?.(
      model,
      event.messages,
      event.id,
      event.idToken,
      event.webSearchEnabled
    ) ?? []) {
      responseStream.write(token);
    }
    responseStream.end();
  }
);
