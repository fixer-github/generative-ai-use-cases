import {
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ContentBlock,
  Message,
  Tool,
  ToolUseBlock,
  ToolResultContentBlock,
  ServiceQuotaExceededException,
  ThrottlingException,
  AccessDeniedException,
  StopReason,
  ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';
import {
  Model,
  StreamingChunk,
  UnrecordedMessage,
  WebSearchMetadata,
  WebSearchQuery,
} from 'generative-ai-use-cases';
import { streamingChunk } from './streamingChunk';
import { initBedrockRuntimeClient } from './bedrockClient';
import { BEDROCK_TEXT_GEN_MODELS } from './models';
import {
  WEB_SEARCH_TOOLS,
  executeWebSearch,
  createToolResultContent,
  createToolErrorContent,
  SearchEngine,
} from './webSearchTool';
import { fetchWebText, createFetchResultContent } from './webTextFetcher';

const MODEL_REGION = process.env.MODEL_REGION as string;
const MAX_TOOL_USE_ITERATIONS = 3; // パフォーマンスのため3回に制限

// Web検索用のシステムプロンプト追加
const WEB_SEARCH_SYSTEM_PROMPT = `
You have access to web search capabilities. When the user asks for current information, recent events, or topics requiring up-to-date data:
1. Formulate effective search queries (consider using multiple related queries if needed)
2. Analyze search results and identify which URLs might need deeper investigation
3. Use the fetch_url tool to get full content when snippets are insufficient
4. Synthesize information from multiple sources
5. Always cite your sources with URLs in your response

Important:
- You can search up to 5 times per conversation
- Be specific with search queries for better results
- Prefer authoritative sources (official documentation, academic papers, reputable news)
`;

// UnrecordedMessageをBedrock Message形式に変換
function convertToBedrockMessages(messages: UnrecordedMessage[]): Message[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((message) => {
      const contentBlocks: ContentBlock[] = [];

      if (message.extraData) {
        // 画像やファイルの処理（既存の実装と同様）
        message.extraData.forEach((extra) => {
          if (extra.type === 'image' && extra.source.type === 'base64') {
            contentBlocks.push({
              image: {
                format: extra.source.mediaType.split('/')[1] as
                  | 'png'
                  | 'jpeg'
                  | 'gif'
                  | 'webp',
                source: {
                  bytes: Buffer.from(extra.source.data, 'base64'),
                },
              },
            } as ContentBlock.ImageMember);
          }
        });
      }

      contentBlocks.push({ text: message.content });

      return {
        role:
          message.role === 'user'
            ? ConversationRole.USER
            : ConversationRole.ASSISTANT,
        content: contentBlocks,
      };
    });
}

// ToolUseBlockを処理してToolResultを返す
async function executeToolUse(
  toolUse: ToolUseBlock,
  webSearchMetadata: WebSearchMetadata
): Promise<{
  content: ToolResultContentBlock[];
  updatedMetadata: WebSearchMetadata;
}> {
  const toolName = toolUse.name;
  const input = toolUse.input as Record<string, unknown>;

  console.log(`Executing tool: ${toolName}`, JSON.stringify(input));

  try {
    if (toolName === 'web_search') {
      const query = input.query as string;
      const numResults = (input.num_results as number) || 3;
      const searchEngine = process.env.SEARCH_ENGINE as SearchEngine;

      const results = await executeWebSearch(query, numResults, searchEngine);

      // メタデータを更新
      const newQuery: WebSearchQuery = {
        query,
        timestamp: new Date().toISOString(),
        results,
      };

      const updatedMetadata: WebSearchMetadata = {
        ...webSearchMetadata,
        queries: [...webSearchMetadata.queries, newQuery],
        totalResultsCount:
          webSearchMetadata.totalResultsCount + results.length,
        searchEngineUsed: searchEngine,
      };

      return {
        content: createToolResultContent(results),
        updatedMetadata,
      };
    } else if (toolName === 'fetch_url') {
      const url = input.url as string;
      const result = await fetchWebText(url, { maxLength: 10000 });

      return {
        content: createFetchResultContent(result),
        updatedMetadata: webSearchMetadata,
      };
    } else {
      return {
        content: createToolErrorContent(`Unknown tool: ${toolName}`),
        updatedMetadata: webSearchMetadata,
      };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`Tool execution error: ${errorMessage}`);
    return {
      content: createToolErrorContent(errorMessage),
      updatedMetadata: webSearchMetadata,
    };
  }
}

// Tool Use対応のストリーミング関数
export async function* invokeStreamWithTools(
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): AsyncGenerator<string> {
  const region = model.region || MODEL_REGION;
  const client = await initBedrockRuntimeClient({ region });

  // Web検索メタデータの初期化
  let webSearchMetadata: WebSearchMetadata = {
    queries: [],
    totalResultsCount: 0,
    referencedResultsCount: 0,
  };

  // システムプロンプトを取得して検索ガイダンスを追加
  const systemMessage = messages.find((msg) => msg.role === 'system');
  const systemPrompt = systemMessage
    ? systemMessage.content + '\n\n' + WEB_SEARCH_SYSTEM_PROMPT
    : WEB_SEARCH_SYSTEM_PROMPT;

  // メッセージを変換
  let conversationMessages = convertToBedrockMessages(messages);

  // モデル設定を取得
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  if (!modelConfig) {
    yield streamingChunk({
      text: `Model ${model.modelId} is not supported for web search.`,
      stopReason: 'error',
    });
    return;
  }

  let iteration = 0;

  try {
    while (iteration < MAX_TOOL_USE_ITERATIONS) {
      iteration++;

      // Converse API呼び出し
      const input: ConverseStreamCommandInput = {
        modelId: model.modelId,
        messages: conversationMessages,
        system: [{ text: systemPrompt }],
        toolConfig: {
          tools: WEB_SEARCH_TOOLS,
        },
        inferenceConfig: modelConfig.defaultParams.inferenceConfig,
      };

      console.log(
        `Iteration ${iteration}: Calling Converse API with ${conversationMessages.length} messages`
      );

      const command = new ConverseStreamCommand(input);
      const response = await client.send(command);

      if (!response.stream) {
        console.error('No stream in response');
        yield streamingChunk({
          text: 'Error: No response stream received from the model.',
          stopReason: 'error',
        });
        return;
      }

      let assistantText = '';
      let toolUseBlocks: ToolUseBlock[] = [];
      let currentToolUse: Partial<ToolUseBlock> | null = null;
      let stopReason: StopReason | undefined;

      for await (const event of response.stream) {
        if (event.contentBlockStart?.start?.toolUse) {
          // ツール使用開始
          currentToolUse = {
            toolUseId: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
            input: '', // JSON文字列として累積するため空文字列で初期化
          };

          // ツール使用開始を通知
          yield streamingChunk({
            text: '',
            toolUse: {
              toolName: currentToolUse.name!,
              toolUseId: currentToolUse.toolUseId!,
              status: 'invoking',
              input: {},
            },
          });
        } else if (event.contentBlockDelta?.delta?.toolUse) {
          // ツール入力の累積
          if (currentToolUse) {
            const inputDelta = event.contentBlockDelta.delta.toolUse.input;
            if (inputDelta) {
              // JSON文字列として累積
              currentToolUse.input =
                ((currentToolUse.input as string) || '') + inputDelta;
            }
          }
        } else if (event.contentBlockStop && currentToolUse) {
          // ツール使用ブロック完了
          try {
            const parsedInput =
              typeof currentToolUse.input === 'string'
                ? JSON.parse(currentToolUse.input)
                : currentToolUse.input;
            console.log(
              `Tool use block completed: ${currentToolUse.name}`,
              JSON.stringify(parsedInput)
            );
            toolUseBlocks.push({
              toolUseId: currentToolUse.toolUseId!,
              name: currentToolUse.name!,
              input: parsedInput,
            });
          } catch (e) {
            console.error(
              'Failed to parse tool input:',
              e,
              'Raw input:',
              currentToolUse.input
            );
            // パース失敗時もツールブロックを追加（空の入力で）
            toolUseBlocks.push({
              toolUseId: currentToolUse.toolUseId!,
              name: currentToolUse.name!,
              input: {},
            });
          }
          currentToolUse = null;
        } else if (event.contentBlockDelta?.delta?.text) {
          // テキスト出力
          const text = event.contentBlockDelta.delta.text;
          assistantText += text;
          yield streamingChunk({ text });
        } else if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
        } else if (event.metadata?.usage) {
          // メタデータを送信
          yield streamingChunk({
            text: '',
            metadata: {
              usage: {
                inputTokens: event.metadata.usage.inputTokens || 0,
                outputTokens: event.metadata.usage.outputTokens || 0,
                totalTokens:
                  (event.metadata.usage.inputTokens || 0) +
                  (event.metadata.usage.outputTokens || 0),
              },
            },
          });
        }
      }

      console.log(
        `Stream completed. stopReason: ${stopReason}, toolUseBlocks: ${toolUseBlocks.length}, assistantText length: ${assistantText.length}`
      );

      // ツール使用がある場合
      if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
        // アシスタントメッセージを追加
        const assistantContent: ContentBlock[] = [];
        if (assistantText) {
          assistantContent.push({ text: assistantText });
        }
        toolUseBlocks.forEach((toolUse) => {
          assistantContent.push({ toolUse });
        });

        conversationMessages.push({
          role: ConversationRole.ASSISTANT,
          content: assistantContent,
        });

        // 各ツールを実行
        const toolResults: ContentBlock[] = [];
        for (const toolUse of toolUseBlocks) {
          console.log(`Executing tool: ${toolUse.name}`);
          const { content, updatedMetadata } = await executeToolUse(
            toolUse,
            webSearchMetadata
          );
          webSearchMetadata = updatedMetadata;
          console.log(`Tool ${toolUse.name} completed, result count: ${content.length}`);

          // ツール結果にstatusフィールドを追加
          const isError = content.some(
            (c) => 'text' in c && (c.text as string)?.startsWith('Error:')
          );
          toolResults.push({
            toolResult: {
              toolUseId: toolUse.toolUseId,
              content,
              status: isError ? 'error' : 'success',
            },
          });

          // ツール完了を通知
          yield streamingChunk({
            text: '',
            toolUse: {
              toolName: toolUse.name!,
              toolUseId: toolUse.toolUseId!,
              status: 'completed',
              input: toolUse.input as Record<string, unknown>,
            },
            webSearchMetadata,
          });
        }

        // ツール結果をメッセージに追加
        conversationMessages.push({
          role: ConversationRole.USER,
          content: toolResults,
        });

        // 次のイテレーションへ
        console.log('Continuing to next iteration...');
        console.log(
          `Message count: ${conversationMessages.length}, Last message role: ${conversationMessages[conversationMessages.length - 1]?.role}`
        );
        continue;
      }

      // stopReasonがtool_useだがtoolUseBlocksが空の場合（パースエラーなど）
      if (stopReason === 'tool_use' && toolUseBlocks.length === 0) {
        console.error(
          'Tool use stop reason received but no tool use blocks were captured'
        );
        yield streamingChunk({
          text: '\n\nError: Failed to process tool use request.',
          stopReason: 'error',
        });
        break;
      }

      // 終了
      yield streamingChunk({
        text: '',
        stopReason: stopReason || 'end_turn',
        webSearchMetadata:
          webSearchMetadata.queries.length > 0 ? webSearchMetadata : undefined,
      });
      break;
    }

    // 最大イテレーション数を超えた場合
    if (iteration >= MAX_TOOL_USE_ITERATIONS) {
      yield streamingChunk({
        text: '\n\n[Maximum search iterations reached]',
        stopReason: 'end_turn',
        webSearchMetadata,
      });
    }
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
