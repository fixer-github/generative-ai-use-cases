import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { invokeStreamWithTools } from './utils/bedrockApiWithTools';

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

    // Web検索が有効な場合はTool Use対応のストリームを使用
    if (event.webSearchEnabled && model.type === 'bedrock') {
      for await (const token of invokeStreamWithTools(
        model,
        event.messages,
        event.id
      )) {
        responseStream.write(token);
      }
    } else {
      // 通常のストリーム処理
      for await (const token of api[model.type].invokeStream?.(
        model,
        event.messages,
        event.id,
        event.idToken
      ) ?? []) {
        responseStream.write(token);
      }
    }
    responseStream.end();
  }
);
