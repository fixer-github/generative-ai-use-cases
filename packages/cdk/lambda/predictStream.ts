import { Handler, Context } from 'aws-lambda';
import { PredictRequest, StreamingChunk } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import { invokeStreamWithTools } from './utils/bedrockApiWithTools';
import { supportsToolUse } from './utils/toolUseSupport';
import { verifyToken } from './utils/auth';
import { streamingChunk } from './utils/streamingChunk';
import {
  LICENSE_ENABLED,
  LlmUsage,
  blockMessage,
  chargeLlmUsageSafely,
  checkLicense,
  isLicenseExemptUsecase,
  usecaseToCategory,
} from './utils/license';

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

    // License gate: all Bedrock text usecases are metered except RAG
    // (requirement 1 and 2; predictTitle / optimizePrompt are separate
    // Lambdas and are intentionally not metered — decision 2026-07-30).
    const meterUsage =
      LICENSE_ENABLED &&
      model.type === 'bedrock' &&
      !isLicenseExemptUsecase(event.id);

    let licenseUserId: string | undefined;
    if (meterUsage) {
      const payload = await verifyToken(event.idToken || '');
      licenseUserId = payload?.['cognito:username'] as string | undefined;
      // Fail-closed: no verifiable user -> no generation (requirement 38)
      const check = licenseUserId
        ? await checkLicense(licenseUserId, { modelId: model.modelId })
        : ({ allowed: false, reason: 'error' } as const);
      if (!check.allowed) {
        responseStream.write(
          streamingChunk({
            text: blockMessage(check.reason),
            stopReason: 'error',
          })
        );
        responseStream.end();
        return;
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

    // Accumulate the token usage that Bedrock reports at the end of the
    // stream (and per LLM call in the web-search tool loop). Charging happens
    // here — the one place every metered generation passes through — rather
    // than at message save time, which the client may never call.
    const usage: LlmUsage = {};
    let sawUsage = false;

    for await (const token of stream) {
      responseStream.write(token);
      if (meterUsage) {
        for (const line of String(token).split('\n')) {
          if (!line) continue;
          try {
            const chunk = JSON.parse(line) as StreamingChunk;
            const u = chunk.metadata?.usage;
            if (u) {
              sawUsage = true;
              usage.inputTokens = (usage.inputTokens ?? 0) + (u.inputTokens ?? 0);
              usage.outputTokens =
                (usage.outputTokens ?? 0) + (u.outputTokens ?? 0);
              usage.cacheReadInputTokens =
                (usage.cacheReadInputTokens ?? 0) +
                (u.cacheReadInputTokens ?? 0);
              usage.cacheWriteInputTokens =
                (usage.cacheWriteInputTokens ?? 0) +
                (u.cacheWriteInputTokens ?? 0);
            }
          } catch {
            // Not a JSON chunk — ignore for metering purposes
          }
        }
      }
    }
    responseStream.end();

    if (meterUsage && licenseUserId) {
      if (sawUsage) {
        // The response has been delivered; charging failures alert the admin
        // instead of failing the request (requirement 39)
        await chargeLlmUsageSafely(
          licenseUserId,
          model.modelId,
          usage,
          usecaseToCategory(event.id)
        );
      } else {
        // No usage metadata (e.g. the model call errored out) -> nothing billed
        console.warn(
          `[license] no usage metadata for usecase=${event.id} model=${model.modelId}; nothing charged`
        );
      }
    }
  }
);
