import {
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ContentBlock,
  ConversationRole,
  Message,
  ServiceQuotaExceededException,
  ThrottlingException,
  AccessDeniedException,
  Tool,
  StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import { Model, UnrecordedMessage, Metadata } from 'generative-ai-use-cases';
import { BEDROCK_TEXT_GEN_MODELS } from './models';
import { streamingChunk } from './streamingChunk';
import { initBedrockRuntimeClient } from './bedrockClient';
import {
  webSearchToolSpec,
  executeWebSearch,
  WebSearchResult,
} from './webSearchTool';
import { fetchUrlToolSpec, executeFetchUrl, FetchUrlResult } from './safeFetch';
import { supportsToolUse } from './toolUseSupport';

const MODEL_REGION = process.env.MODEL_REGION as string;
const MAX_PER_TOOL = 3;
const MAX_TOOL_LOOPS = 8; // Hard ceiling

const formatWebSearchResultForTool = (
  result: WebSearchResult,
  keyword: string
): string => {
  if (!result.ok) {
    return `web_search に失敗しました: ${result.message}`;
  }
  if (result.results.length === 0) {
    return `「${keyword}」の検索結果は見つかりませんでした。`;
  }
  return result.results
    .map((r) => `Source: ${r.url}\nTitle: ${r.title}\n\n${r.snippet}`)
    .join('\n\n---\n\n');
};

const formatFetchUrlResultForTool = (result: FetchUrlResult): string => {
  if (!result.ok) {
    return `fetch_url に失敗しました: ${result.message}`;
  }
  const header = [
    `Source: ${result.url}`,
    result.title ? `Title: ${result.title}` : null,
    `Fetched at: ${result.fetched_at}`,
    result.truncated ? 'Truncated: true' : null,
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n\n${result.content_markdown}`;
};

const buildBaseInput = (
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): ConverseStreamCommandInput => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.createConverseStreamCommandInput(
    messages,
    id,
    model,
    modelConfig.defaultParams,
    modelConfig.usecaseParams
  );
};

type ToolName = 'web_search' | 'fetch_url';

const isToolUseBlock = (
  block: ContentBlock
): block is ContentBlock.ToolUseMember => 'toolUse' in block && !!block.toolUse;

export async function* invokeStreamWithTools(
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): AsyncGenerator<string> {
  const region = model.region || MODEL_REGION;
  const client = await initBedrockRuntimeClient({ region });

  // Working copy of messages that we will extend with assistant tool-use turns
  // and user tool-result turns as the loop progresses.
  // We keep system messages in `UnrecordedMessage[]` form for the createConverseStreamCommandInput
  // call (which extracts system from messages). Tool-use / tool-result turns
  // cannot be expressed as UnrecordedMessage, so we inject them directly into
  // input.messages after the base input is built each iteration.
  const baseMessages: UnrecordedMessage[] = [...messages];
  const extraTurns: Message[] = [];

  let webSearchCount = 0;
  let fetchUrlCount = 0;

  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const baseInput = buildBaseInput(model, baseMessages, id);

      // Append the accumulated tool-use / tool-result turns.
      const input: ConverseStreamCommandInput = {
        ...baseInput,
        messages: [...(baseInput.messages ?? []), ...extraTurns],
      };

      // Decide which tools to advertise this turn.
      const tools: Tool[] = [];
      if (webSearchCount < MAX_PER_TOOL) tools.push(webSearchToolSpec);
      if (fetchUrlCount < MAX_PER_TOOL) tools.push(fetchUrlToolSpec);
      if (supportsToolUse(model.modelId)) {
        if (tools.length > 0) {
          input.toolConfig = { tools };
        } else if (extraTurns.length > 0) {
          // 両ツールが MAX_PER_TOOL に到達。messages には過去の
          // toolUse / toolResult が残っているため、Bedrock の制約上
          // toolConfig.tools を空にできない。全ツールを再アドバタイズし、
          // 再呼び出しは実行時ガード (limit_exceeded を返す) で弾く。
          input.toolConfig = {
            tools: [webSearchToolSpec, fetchUrlToolSpec],
          };
        }
      }

      const command = new ConverseStreamCommand(input);
      const responseStream = await client.send(command);

      if (!responseStream.stream) return;

      // Accumulators for the assistant message we are reconstructing.
      const blockBuilders: Record<
        number,
        {
          type: 'text' | 'toolUse' | 'reasoning';
          text: string;
          toolUseId?: string;
          toolName?: string;
          toolInputJson: string;
          reasoningText?: string;
          reasoningSignature?: string;
          redactedContent?: Uint8Array;
        }
      > = {};
      let stopReason: StopReason | undefined;
      let textYielded = false;

      for await (const event of responseStream.stream) {
        if (!event) break;

        // contentBlockStart: announces a new block (toolUse blocks always start here).
        if (event.contentBlockStart) {
          const idx = event.contentBlockStart.contentBlockIndex ?? 0;
          const start = event.contentBlockStart.start;
          if (start && 'toolUse' in start && start.toolUse) {
            blockBuilders[idx] = {
              type: 'toolUse',
              text: '',
              toolUseId: start.toolUse.toolUseId,
              toolName: start.toolUse.name,
              toolInputJson: '',
            };
          }
        }

        if (event.contentBlockDelta) {
          const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
          const delta = event.contentBlockDelta.delta;
          if (!delta) continue;

          if ('text' in delta && delta.text) {
            if (!blockBuilders[idx]) {
              blockBuilders[idx] = {
                type: 'text',
                text: '',
                toolInputJson: '',
              };
            }
            blockBuilders[idx].text += delta.text;
            textYielded = true;
            yield streamingChunk({ text: delta.text });
          } else if ('toolUse' in delta && delta.toolUse?.input) {
            if (!blockBuilders[idx]) {
              blockBuilders[idx] = {
                type: 'toolUse',
                text: '',
                toolInputJson: '',
              };
            }
            blockBuilders[idx].toolInputJson += delta.toolUse.input;
          } else if ('reasoningContent' in delta && delta.reasoningContent) {
            // reasoning ブロックは extended thinking 有効時に流れてくる。
            // 後続ループに送り返す際、Bedrock は reasoningText.text と
            // signature をそのまま保持していることを検証するため、ここで
            // 全フィールドを蓄積し、assistantBlocks 再構築時に復元する。
            const rc = delta.reasoningContent;
            if (!blockBuilders[idx]) {
              blockBuilders[idx] = {
                type: 'reasoning',
                text: '',
                toolInputJson: '',
                reasoningText: '',
              };
            }
            if ('text' in rc && rc.text) {
              blockBuilders[idx].reasoningText =
                (blockBuilders[idx].reasoningText ?? '') + rc.text;
              yield streamingChunk({ text: '', trace: rc.text });
            } else if ('signature' in rc && rc.signature) {
              blockBuilders[idx].reasoningSignature = rc.signature;
            } else if ('redactedContent' in rc && rc.redactedContent) {
              blockBuilders[idx].redactedContent = rc.redactedContent;
            }
          }
        }

        if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
        }

        if (event.metadata && event.metadata.usage) {
          yield streamingChunk({
            text: '',
            metadata: { usage: event.metadata.usage } as Metadata,
          });
        }
      }

      // Reconstruct the assistant content blocks for the next turn.
      const assistantBlocks: ContentBlock[] = [];
      const sortedIndices = Object.keys(blockBuilders)
        .map((k) => parseInt(k, 10))
        .sort((a, b) => a - b);
      for (const i of sortedIndices) {
        const b = blockBuilders[i];
        if (b.type === 'reasoning') {
          if (b.redactedContent) {
            assistantBlocks.push({
              reasoningContent: {
                redactedContent: b.redactedContent,
              },
            } as ContentBlock);
          } else if (b.reasoningText) {
            assistantBlocks.push({
              reasoningContent: {
                reasoningText: {
                  text: b.reasoningText,
                  ...(b.reasoningSignature
                    ? { signature: b.reasoningSignature }
                    : {}),
                },
              },
            } as ContentBlock);
          }
        } else if (b.type === 'text' && b.text) {
          assistantBlocks.push({ text: b.text } as ContentBlock);
        } else if (b.type === 'toolUse' && b.toolUseId && b.toolName) {
          let parsed: unknown = {};
          if (b.toolInputJson && b.toolInputJson.trim().length > 0) {
            try {
              parsed = JSON.parse(b.toolInputJson);
            } catch (e) {
              console.warn(
                'Failed to parse tool input JSON',
                e,
                b.toolInputJson
              );
              parsed = {};
            }
          }
          assistantBlocks.push({
            toolUse: {
              toolUseId: b.toolUseId,
              name: b.toolName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              input: parsed as any,
            },
          } as ContentBlock);
        }
      }

      if (stopReason !== 'tool_use') {
        // Final answer reached - propagate stop reason to the client.
        if (stopReason) {
          yield streamingChunk({ text: '', stopReason });
        }
        return;
      }

      // Execute every tool use block in order. Append results back into the conversation.
      const toolResultBlocks: ContentBlock[] = [];
      for (const block of assistantBlocks) {
        if (!isToolUseBlock(block)) continue;
        const tu = block.toolUse!;
        const name = tu.name as ToolName;
        const toolUseId = tu.toolUseId!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputObj = (tu.input ?? {}) as any;

        if (name === 'web_search') {
          const keyword = String(inputObj.keyword ?? '').trim();
          if (!keyword) {
            const body = JSON.stringify({
              error: 'invalid_input',
              message: 'keyword が空です。',
            });
            toolResultBlocks.push({
              toolResult: {
                toolUseId,
                content: [{ text: body }],
                status: 'error',
              },
            } as ContentBlock);
            continue;
          }
          // toolConfig は turn 開始時にしか判定しないため、1 応答内で同じツールが
          // 複数回呼ばれると MAX_PER_TOOL を超え得る。実行直前にもガードする。
          if (webSearchCount >= MAX_PER_TOOL) {
            const body = JSON.stringify({
              error: 'limit_exceeded',
              message: `web_search の呼び出し回数が上限 ${MAX_PER_TOOL} に達しました。これ以上ツールを呼び出さず、これまでに得た情報だけで回答してください。`,
            });
            toolResultBlocks.push({
              toolResult: {
                toolUseId,
                content: [{ text: body }],
                status: 'error',
              },
            } as ContentBlock);
            continue;
          }
          yield streamingChunk({
            trace: `🔍 「${keyword}」を検索中…\n`,
            text: '',
          });
          const result = await executeWebSearch(keyword);
          webSearchCount++;
          if (result.ok) {
            const lines = result.results.map((r) => `  ▸ ${r.url}`).join('\n');
            yield streamingChunk({
              trace: `✓ ${result.results.length} 件のソースを参照\n${lines}\n`,
              text: '',
            });
          } else {
            yield streamingChunk({
              trace: `⚠️ 検索に失敗しました: ${result.message}\n`,
              text: '',
            });
          }
          const text = formatWebSearchResultForTool(result, keyword);
          toolResultBlocks.push({
            toolResult: {
              toolUseId,
              content: [{ text }],
              status: result.ok ? 'success' : 'error',
            },
          } as ContentBlock);
        } else if (name === 'fetch_url') {
          const url = String(inputObj.url ?? '').trim();
          if (!url) {
            const body = JSON.stringify({
              error: 'invalid_input',
              message: 'url が空です。',
            });
            toolResultBlocks.push({
              toolResult: {
                toolUseId,
                content: [{ text: body }],
                status: 'error',
              },
            } as ContentBlock);
            continue;
          }
          if (fetchUrlCount >= MAX_PER_TOOL) {
            const body = JSON.stringify({
              error: 'limit_exceeded',
              message: `fetch_url の呼び出し回数が上限 ${MAX_PER_TOOL} に達しました。これ以上ツールを呼び出さず、これまでに得た情報だけで回答してください。`,
            });
            toolResultBlocks.push({
              toolResult: {
                toolUseId,
                content: [{ text: body }],
                status: 'error',
              },
            } as ContentBlock);
            continue;
          }
          yield streamingChunk({
            trace: `📄 ${url} を読み込み中…\n`,
            text: '',
          });
          const result = await executeFetchUrl(url);
          fetchUrlCount++;
          if (result.ok) {
            yield streamingChunk({
              trace: `✓ ${result.url} を読み込み完了${result.truncated ? '（途中で打ち切り）' : ''}\n`,
              text: '',
            });
          } else {
            yield streamingChunk({
              trace: `⚠️ 読み込みに失敗しました: ${result.message}\n`,
              text: '',
            });
          }
          const text = formatFetchUrlResultForTool(result);
          toolResultBlocks.push({
            toolResult: {
              toolUseId,
              content: [{ text }],
              status: result.ok ? 'success' : 'error',
            },
          } as ContentBlock);
        } else {
          // Unknown tool - report error back to the model.
          const body = JSON.stringify({
            error: 'unknown_tool',
            message: `未知のツール ${name} が呼ばれました。`,
          });
          toolResultBlocks.push({
            toolResult: {
              toolUseId,
              content: [{ text: body }],
              status: 'error',
            },
          } as ContentBlock);
        }
      }

      // Push the assistant turn (with tool uses) and the user tool-result turn.
      extraTurns.push({
        role: ConversationRole.ASSISTANT,
        content: assistantBlocks,
      });
      extraTurns.push({
        role: ConversationRole.USER,
        content: toolResultBlocks,
      });

      void textYielded; // reserved for future heuristics
    }

    // Loop budget exhausted - terminate gracefully.
    yield streamingChunk({
      text: '\n\n（ツール呼び出し回数の上限に達しました）',
      stopReason: 'end_turn',
    });
  } catch (e) {
    if (
      e instanceof ThrottlingException ||
      e instanceof ServiceQuotaExceededException
    ) {
      yield streamingChunk({
        text: 'The server is currently experiencing high access. Please try again later.',
        stopReason: 'error',
      });
    } else if (e instanceof AccessDeniedException) {
      const modelAccessURL = `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`;
      yield streamingChunk({
        text: `The selected model is not enabled. Please enable the model in the [Bedrock console Model Access screen](${modelAccessURL}).`,
        stopReason: 'error',
      });
    } else {
      console.error(e);
      yield streamingChunk({
        text:
          'An error occurred. Please report the following error to the administrator.\n' +
          e,
        stopReason: 'error',
      });
    }
  }
}
