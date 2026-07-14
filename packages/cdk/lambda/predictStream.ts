/* eslint-disable i18nhelper/no-jp-string */
import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { invokeStreamWithTools } from './utils/bedrockApiWithTools';
import { supportsToolUse } from './utils/toolUseSupport';
import { streamingChunk } from './utils/streamingChunk';
import { verifyToken } from './utils/auth';
import { checkAndIncrementUsage } from './utils/license';

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

    // License limit enforcement: chat use cases only (design 6-B).
    // Unassigned users and idToken verification failures are treated as unlimited,
    // either in checkAndIncrementUsage or here (design 6-C, same tolerance pattern as bedrockKbApi.ts).
    if (isChatUsecase(event.id)) {
      const payload = await verifyToken(event.idToken || '');
      const userId = payload?.['cognito:username'] as string | undefined;
      if (userId) {
        const result = await checkAndIncrementUsage(userId);
        if (!result.allowed) {
          responseStream.write(
            streamingChunk({
              text: `今月の利用上限（${result.limit}回）に達しました。毎月1日にリセットされます。`,
              stopReason: 'error',
            })
          );
          responseStream.end();
          return;
        }
      }
    }

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
      : (api[model.type].invokeStream?.(
          model,
          event.messages,
          event.id,
          event.idToken
        ) ?? []);

    for await (const token of stream) {
      responseStream.write(token);
    }
    responseStream.end();
  }
);
