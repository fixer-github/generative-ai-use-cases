import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { invokeStreamWithTools } from './utils/bedrockApiWithTools';
import { supportsToolUse } from './utils/toolUseSupport';

declare global {
  namespace awslambda {
    function streamifyResponse(
      f: (
        event: PredictRequest,
        responseStream: NodejsWritableStream,
        context: Context
      ) => Promise<void>
    ): Handler;
  }
}
type NodejsWritableStream = NodeJS.WritableStream;

const isChatUsecase = (id: string | undefined): boolean => {
  if (!id) return false;
  return id === '/chat' || id.startsWith('/chat/');
};

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const model = event.model || defaultModel;

    const hasSearchKey =
      !!process.env.SEARCH_API_KEY || !!process.env.SEARCH_API_KEY_SSM_PARAM;
    const useWebSearch =
      model.type === 'bedrock' &&
      event.webSearchEnabled === true &&
      isChatUsecase(event.id) &&
      supportsToolUse(model.modelId) &&
      hasSearchKey;

    const stream = useWebSearch
      ? invokeStreamWithTools(model, event.messages, event.id)
      : api[model.type].invokeStream?.(
          model,
          event.messages,
          event.id,
          event.idToken
        ) ?? [];

    for await (const token of stream) {
      responseStream.write(token);
    }
    responseStream.end();
  }
);
