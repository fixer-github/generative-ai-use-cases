import {
  InvokeModelCommand,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
  ServiceQuotaExceededException,
  ThrottlingException,
  AccessDeniedException,
  StartAsyncInvokeCommand,
  ToolConfiguration,
  ContentBlock,
  Message,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ApiInterface,
  BedrockImageGenerationResponse,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  StreamingChunk,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import {
  BEDROCK_TEXT_GEN_MODELS,
  BEDROCK_IMAGE_GEN_MODELS,
  BEDROCK_VIDEO_GEN_MODELS,
} from './models';
import { streamingChunk } from './streamingChunk';
import { initBedrockRuntimeClient } from './bedrockClient';
import { search } from './webSearch';

const MODEL_REGION = process.env.MODEL_REGION as string;
const SEARCH_API_KEY = process.env.SEARCH_API_KEY;
const SEARCH_ENGINE = process.env.SEARCH_ENGINE as 'Brave' | 'Tavily' | undefined;

// Web検索ツールの定義
const WEB_SEARCH_TOOL_CONFIG: ToolConfiguration = {
  tools: [
    {
      toolSpec: {
        name: 'web_search',
        description: `Web検索ツール。以下の場合は必ずこのツールを使用してください：
- ユーザーが最新情報、ニュース、現在のデータを求めている場合
- 「今日」「最新」「現在」「最近」「2024年」「2025年」などの時間に関する言葉が含まれる場合
- 天気、為替、株価、スポーツの結果など、リアルタイムで変化する情報
- あなたの学習データ以降に起きた可能性のある出来事
- ユーザーが明示的に「調べて」「検索して」と依頼した場合
このツールが利用可能な場合、不確実な情報を推測するよりも、まず検索することを優先してください。`,
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  '検索クエリ。ユーザーの質問から最も関連性の高いキーワードを抽出してください。',
              },
            },
            required: ['query'],
          },
        },
      },
    },
  ],
};

const createConverseCommandInput = (
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): ConverseCommandInput => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.createConverseCommandInput(
    messages,
    id,
    model,
    modelConfig.defaultParams,
    modelConfig.usecaseParams
  );
};

const createConverseStreamCommandInput = (
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

const extractConverseOutput = (
  model: Model,
  output: ConverseCommandOutput
): StreamingChunk => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.extractConverseOutput(output);
};

const extractConverseStreamOutput = (
  model: Model,
  output: ConverseStreamOutput
): StreamingChunk => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.extractConverseStreamOutput(output);
};

const createBodyImage = (model: Model, params: GenerateImageParams): string => {
  const modelConfig = BEDROCK_IMAGE_GEN_MODELS[model.modelId];
  return modelConfig.createBodyImage(params);
};

const extractOutputImage = (
  model: Model,
  response: BedrockImageGenerationResponse
): string => {
  const modelConfig = BEDROCK_IMAGE_GEN_MODELS[model.modelId];
  return modelConfig.extractOutputImage(response);
};

const createBodyVideo = (model: Model, params: GenerateVideoParams) => {
  const modelConfig = BEDROCK_VIDEO_GEN_MODELS[model.modelId];
  return modelConfig.createBodyVideo(params);
};

const bedrockApi: Omit<ApiInterface, 'invokeFlow'> = {
  invoke: async (model, messages, id) => {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });

    const converseCommandInput = createConverseCommandInput(
      model,
      messages,
      id
    );
    const command = new ConverseCommand(converseCommandInput);
    const output = await client.send(command);

    return extractConverseOutput(model, output).text;
  },
  invokeStream: async function* (model, messages, id, _idToken, webSearchEnabled) {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });

    // Web検索が有効かつAPIキーが設定されている場合のみツールを有効化
    const useWebSearch = webSearchEnabled && SEARCH_API_KEY && SEARCH_ENGINE;
    const maxToolUseIterations = 3; // 無限ループ防止

    // デバッグログ
    console.log('[BedrockApi] invokeStream called');
    console.log('[BedrockApi] webSearchEnabled:', webSearchEnabled);
    console.log('[BedrockApi] SEARCH_API_KEY exists:', !!SEARCH_API_KEY);
    console.log('[BedrockApi] SEARCH_ENGINE:', SEARCH_ENGINE);
    console.log('[BedrockApi] useWebSearch:', useWebSearch);

    try {
      // メッセージ履歴をBedrockのMessage形式で保持
      const conversationHistory: Message[] = [];

      // 初期メッセージを設定
      const initialInput = createConverseStreamCommandInput(model, messages, id);
      if (initialInput.messages) {
        conversationHistory.push(...(initialInput.messages as Message[]));
      }

      let continueLoop = true;
      let iteration = 0;

      while (continueLoop && iteration < maxToolUseIterations) {
        iteration++;

        const converseStreamCommandInput = createConverseStreamCommandInput(
          model,
          messages,
          id
        );

        // Tool Useが有効な場合はツール設定を追加
        if (useWebSearch) {
          converseStreamCommandInput.toolConfig = WEB_SEARCH_TOOL_CONFIG;
        }

        // 2回目以降のイテレーションでは会話履歴を使用
        if (iteration > 1) {
          converseStreamCommandInput.messages = conversationHistory;
        }

        const command = new ConverseStreamCommand(converseStreamCommandInput);
        const responseStream = await client.send(command);

        if (!responseStream.stream) {
          return;
        }

        // Tool Use関連の状態管理
        let toolUseId: string | undefined;
        let toolName: string | undefined;
        let toolInputJson = '';
        const assistantContentBlocks: ContentBlock[] = [];
        let currentTextContent = '';

        for await (const response of responseStream.stream) {
          if (!response) {
            break;
          }

          // テキストコンテンツの処理
          if (response.contentBlockDelta?.delta?.text) {
            const text = response.contentBlockDelta.delta.text;
            currentTextContent += text;
            yield streamingChunk({ text });
          }

          // Tool Use開始の検出
          if (response.contentBlockStart?.start?.toolUse) {
            toolUseId = response.contentBlockStart.start.toolUse.toolUseId;
            toolName = response.contentBlockStart.start.toolUse.name;
            toolInputJson = '';

            // 検索開始を通知
            yield streamingChunk({
              text: '',
              webSearch: { status: 'searching' },
            });
          }

          // Tool Use入力の蓄積
          if (response.contentBlockDelta?.delta?.toolUse?.input) {
            toolInputJson += response.contentBlockDelta.delta.toolUse.input;
          }

          // コンテンツブロック終了時の処理
          if (response.contentBlockStop) {
            if (currentTextContent) {
              assistantContentBlocks.push({ text: currentTextContent });
              currentTextContent = '';
            }
            if (toolUseId && toolName) {
              try {
                const toolInput = JSON.parse(toolInputJson);
                assistantContentBlocks.push({
                  toolUse: {
                    toolUseId,
                    name: toolName,
                    input: toolInput,
                  },
                });
              } catch {
                console.error('Failed to parse tool input JSON:', toolInputJson);
              }
            }
          }

          // その他の出力（trace, metadata）
          const output = extractConverseStreamOutput(model, response);
          if (output.trace || output.metadata) {
            yield streamingChunk({
              text: '',
              trace: output.trace,
              metadata: output.metadata,
            });
          }

          // ストップリーズンの処理
          if (response.messageStop) {
            const stopReason = response.messageStop.stopReason;

            if (stopReason === 'tool_use' && toolUseId && toolName === 'web_search' && useWebSearch) {
              // アシスタントメッセージを会話履歴に追加
              conversationHistory.push({
                role: 'assistant',
                content: assistantContentBlocks,
              });

              // 検索を実行
              try {
                const toolInput = JSON.parse(toolInputJson);
                const query = toolInput.query as string;

                yield streamingChunk({
                  text: '',
                  webSearch: { status: 'searching', query },
                });

                const searchResults = await search(query, SEARCH_ENGINE);

                yield streamingChunk({
                  text: '',
                  webSearch: {
                    status: 'completed',
                    query,
                    results: searchResults.map((r) => ({
                      title: r.title,
                      url: r.url,
                      content: r.content,
                    })),
                  },
                });

                // Tool結果を会話履歴に追加
                conversationHistory.push({
                  role: 'user',
                  content: [
                    {
                      toolResult: {
                        toolUseId,
                        content: [
                          {
                            text: JSON.stringify(searchResults),
                          },
                        ],
                      },
                    },
                  ],
                });

                // ループを継続して回答を生成
                continueLoop = true;
              } catch (error) {
                console.error('Web search error:', error);
                yield streamingChunk({
                  text: '',
                  webSearch: {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error',
                  },
                });

                // エラー時もtool_resultを返す（エラーメッセージ付き）
                conversationHistory.push({
                  role: 'user',
                  content: [
                    {
                      toolResult: {
                        toolUseId,
                        content: [
                          {
                            text: 'Search failed. Please provide an answer based on your existing knowledge.',
                          },
                        ],
                        status: 'error',
                      },
                    },
                  ],
                });
                continueLoop = true;
              }
            } else {
              // 通常の終了
              yield streamingChunk({
                text: '',
                stopReason,
              });
              continueLoop = false;
            }
          }
        }
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
  },
  generateImage: async (model, params) => {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });

    // Image generation using Stable Diffusion or Titan Image Generator is not supported for the Converse API, so InvokeModelCommand is used.
    const command = new InvokeModelCommand({
      modelId: model.modelId,
      body: createBodyImage(model, params),
      contentType: 'application/json',
    });
    const res = await client.send(command);
    const body = JSON.parse(Buffer.from(res.body).toString('utf-8'));

    return extractOutputImage(model, body);
  },
  generateVideo: async (model, params: GenerateVideoParams) => {
    const videoBucketRegionMap = JSON.parse(
      process.env.VIDEO_BUCKET_REGION_MAP ?? '{}'
    );
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });
    const tmpOutputBucket = videoBucketRegionMap[region];

    if (!tmpOutputBucket || tmpOutputBucket.length === 0) {
      throw new Error('Video tmp buket is not defined');
    }

    const command = new StartAsyncInvokeCommand({
      modelId: model.modelId,
      modelInput: createBodyVideo(model, params),
      outputDataConfig: {
        s3OutputDataConfig: {
          s3Uri: `s3://${tmpOutputBucket}`,
          bucketOwner: process.env.VIDEO_BUCKET_OWNER, // Required for cross-account access
        },
      },
    });
    const res = await client.send(command);
    return res.invocationArn!;
  },
};

export default bedrockApi;
