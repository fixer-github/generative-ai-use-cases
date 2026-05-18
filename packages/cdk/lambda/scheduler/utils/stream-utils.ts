/* eslint-disable i18nhelper/no-jp-string */
/**
 * AgentCore Stream Response Processing
 *
 * Converts SSE-format streaming response from InvokeAgentRuntimeCommand
 * into buffered text output for batch processing in Lambda.
 *
 * Based on the stream format used by StrandsStreamProcessor in the frontend,
 * but simplified for server-side batch use (only extracts text + token metadata).
 */

import { TokenUsage } from '../types';

const MAX_RESULT_SIZE = 300 * 1024; // 300KB
const TRUNCATION_MESSAGE = '\n\n[出力が上限を超えたため省略されました]';

export interface StreamResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/**
 * Collect streaming response from InvokeAgentRuntimeCommand into text + metadata.
 */
export async function collectStreamResponse(response: {
  response?: AsyncIterable<Uint8Array>;
}): Promise<StreamResult> {
  const stream = response.response;
  if (!stream) {
    return { text: '' };
  }

  let buffer = '';
  let resultText = '';
  let truncated = false;
  let tokenUsage: TokenUsage | undefined;

  for await (const chunk of stream) {
    const chunkText = new TextDecoder('utf-8').decode(chunk);
    buffer += chunkText;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const data = line.startsWith('data: ') ? line.substring(6) : line;
      try {
        const parsed = JSON.parse(data);
        const event = parsed.event;
        if (!event) continue;

        // Extract text content
        if (event.contentBlockDelta?.delta?.text) {
          if (!truncated) {
            resultText += event.contentBlockDelta.delta.text;
            if (resultText.length > MAX_RESULT_SIZE) {
              resultText =
                resultText.substring(0, MAX_RESULT_SIZE) + TRUNCATION_MESSAGE;
              truncated = true;
            }
          }
        }

        // Extract token usage from metadata
        if (event.metadata?.usage) {
          tokenUsage = {
            inputTokens: event.metadata.usage.inputTokens || 0,
            outputTokens: event.metadata.usage.outputTokens || 0,
          };
        }

        // Also check messageStop for usage in some response formats
        if (event.messageComplete?.usage) {
          tokenUsage = {
            inputTokens: event.messageComplete.usage.inputTokens || 0,
            outputTokens: event.messageComplete.usage.outputTokens || 0,
          };
        }
      } catch {
        // Non-JSON event lines are ignored
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const data = buffer.startsWith('data: ') ? buffer.substring(6) : buffer;
    try {
      const parsed = JSON.parse(data);
      const event = parsed.event;
      if (event?.contentBlockDelta?.delta?.text && !truncated) {
        resultText += event.contentBlockDelta.delta.text;
      }
    } catch {
      // Ignore
    }
  }

  return { text: resultText, tokenUsage };
}
