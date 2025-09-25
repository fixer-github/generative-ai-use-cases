import {
  ApiInterface,
  Metadata,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConversationRole,
  ContentBlock,
  Message,
  StopReason,
  Tool,
  ToolConfiguration,
  ToolResultBlock,
  ToolResultContentBlock,
  ToolResultStatus,
} from '@aws-sdk/client-bedrock-runtime';
import { StateGraph, END } from '@langchain/langgraph';
import { streamingChunk } from './streamingChunk';
import {
  initBedrockAgentRuntimeClient,
  initBedrockRuntimeClient,
} from './bedrockClient';
import { BEDROCK_TEXT_GEN_MODELS } from './models';

const BOT_TABLE_NAME = process.env.BOT_TABLE_NAME;
const MODEL_REGION = process.env.MODEL_REGION ?? 'us-east-1';

if (!BOT_TABLE_NAME) {
  console.warn(
    'BOT_TABLE_NAME is not defined. Chatbot API will not function properly.'
  );
}

const dynamoDbDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({})
);

type ToolInput = Record<string, unknown>;

type ToolRequest = {
  toolUseId: string;
  name: string;
  input: ToolInput;
};

interface BotKnowledgeBaseConfig {
  knowledgeBaseId: string;
  maxResults?: number;
  searchType?: 'SEMANTIC' | 'HYBRID';
}

interface BotInfo {
  botId: string;
  title?: string;
  instruction?: string;
  generationParams?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  knowledgeBase?: BotKnowledgeBaseConfig;
  knowledgeDescription?: string;
}

interface GraphState {
  inputMessages: UnrecordedMessage[];
  bot?: BotInfo;
  commandInput?: ConverseStreamCommandInput;
  conversation?: Message[];
  stopReason?: StopReason;
  metadata?: Metadata;
  toolRequests?: ToolRequest[];
  emit: (chunk: string) => void;
}

interface GraphContext {
  model: Model;
  botId: string;
  requestId: string;
}

type PartialContent =
  | { type: 'text'; text: string }
  | {
      type: 'toolUse';
      toolUseId: string;
      name: string;
      inputText: string;
      parsedInput?: ToolInput;
    };

const chatbotWorkflow = (() => {
  const workflow = new StateGraph<GraphState>({});

  workflow.addNode('loadBot', async (state, context: GraphContext) => {
    const bot = await getBotInfo(context.botId);
    return { bot };
  });

  workflow.addNode('prepareConversation', async (state, context: GraphContext) => {
    const { model, requestId } = context;
    const { bot, inputMessages } = state;

    if (!bot) {
      throw new Error('Bot information is not available.');
    }

    const instruction = buildInstruction(inputMessages, bot);
    const preparedMessages = prepareMessages(inputMessages, instruction);

    const bedrockModelId = model.modelId;
    const modelConfig = BEDROCK_TEXT_GEN_MODELS[bedrockModelId];

    if (!modelConfig) {
      throw new Error(`Model configuration for ${bedrockModelId} is not available.`);
    }

    const bedrockModel: Model = {
      type: 'bedrock',
      modelId: bedrockModelId,
      modelParameters: model.modelParameters,
      region: model.region,
      sessionId: model.sessionId,
    };

    const commandInput = modelConfig.createConverseStreamCommandInput(
      preparedMessages,
      requestId,
      bedrockModel,
      modelConfig.defaultParams,
      modelConfig.usecaseParams
    );

    if (bot.generationParams) {
      commandInput.inferenceConfig = {
        ...commandInput.inferenceConfig,
        ...(bot.generationParams.maxTokens
          ? { maxTokens: bot.generationParams.maxTokens }
          : {}),
        ...(bot.generationParams.temperature !== undefined
          ? { temperature: bot.generationParams.temperature }
          : {}),
        ...(bot.generationParams.topP !== undefined
          ? { topP: bot.generationParams.topP }
          : {}),
      };
    }

    const toolConfig = buildToolConfiguration(bot);
    if (toolConfig) {
      commandInput.toolConfig = mergeToolConfiguration(
        commandInput.toolConfig,
        toolConfig
      );
    }

    const conversation = commandInput.messages ?? [];

    return {
      commandInput,
      conversation,
    };
  });

  workflow.addNode('invokeModel', async (state, context: GraphContext) => {
    if (!state.commandInput) {
      throw new Error('Command input is not prepared.');
    }

    const conversation = state.conversation ?? [];
    const runtimeClient = await initBedrockRuntimeClient({
      region: context.model.region || MODEL_REGION,
    });

    const commandInput: ConverseStreamCommandInput = {
      ...state.commandInput,
      messages: conversation,
    };

    const command = new ConverseStreamCommand(commandInput);
    const response = await runtimeClient.send(command);

    let stopReason: StopReason | undefined;
    let metadata: Metadata | undefined;
    const toolRequests: ToolRequest[] = [];

    const currentMessage: {
      role: ConversationRole | undefined;
      contents: Map<number, PartialContent>;
    } = {
      role: ConversationRole.ASSISTANT,
      contents: new Map(),
    };

    const stream = response.stream;
    if (stream) {
      for await (const event of stream) {
        if (event.messageStart) {
          currentMessage.role =
            event.messageStart.role ?? ConversationRole.ASSISTANT;
        } else if (event.contentBlockStart) {
          const { contentBlockIndex, start } = event.contentBlockStart;
          if (typeof contentBlockIndex === 'number' && start?.toolUse) {
            currentMessage.contents.set(contentBlockIndex, {
              type: 'toolUse',
              toolUseId: start.toolUse.toolUseId ?? '',
              name: start.toolUse.name ?? '',
              inputText: '',
            });
          }
        } else if (event.contentBlockDelta) {
          const { contentBlockIndex, delta } = event.contentBlockDelta;

          if (typeof contentBlockIndex !== 'number') {
            continue;
          }

          if (delta?.text) {
            const existing = currentMessage.contents.get(contentBlockIndex);
            if (existing && existing.type === 'text') {
              existing.text += delta.text;
            } else {
              currentMessage.contents.set(contentBlockIndex, {
                type: 'text',
                text: delta.text,
              });
            }

            state.emit(
              streamingChunk({
                text: delta.text,
              })
            );
          } else if (delta?.toolUse?.input) {
            const existing = currentMessage.contents.get(contentBlockIndex);
            if (existing && existing.type === 'toolUse') {
              existing.inputText += delta.toolUse.input;
            }
          }
        } else if (event.contentBlockStop) {
          const { contentBlockIndex } = event.contentBlockStop;
          if (typeof contentBlockIndex !== 'number') {
            continue;
          }
          const content = currentMessage.contents.get(contentBlockIndex);
          if (content && content.type === 'toolUse') {
            let parsed: ToolInput = {};
            if (content.inputText.trim()) {
              try {
                parsed = JSON.parse(content.inputText);
              } catch (error) {
                console.error('Failed to parse tool input', error);
              }
            }
            content.parsedInput = parsed;
            toolRequests.push({
              toolUseId: content.toolUseId,
              name: content.name,
              input: parsed,
            });
          }
        } else if (event.messageStop) {
          stopReason = event.messageStop.stopReason ?? StopReason.END_TURN;
        } else if (event.metadata?.usage) {
          const usage = event.metadata.usage;
          metadata = {
            usage: {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
              cacheReadInputTokens: usage.cacheReadInputTokens ?? undefined,
              cacheWriteInputTokens: usage.cacheWriteInputTokens ?? undefined,
            },
          };
        }
      }
    }

    const assistantMessage = buildAssistantMessage(currentMessage);
    const updatedConversation = assistantMessage
      ? [...conversation, assistantMessage]
      : conversation;

    return {
      conversation: updatedConversation,
      commandInput: {
        ...state.commandInput,
        messages: updatedConversation,
      },
      stopReason,
      metadata,
      toolRequests,
    };
  });

  workflow.addNode('executeTools', async (state) => {
    if (!state.bot || !state.toolRequests || state.toolRequests.length === 0) {
      return {};
    }

    const commandInput = state.commandInput;
    if (!commandInput) {
      return {
        toolRequests: undefined,
        stopReason: undefined,
      };
    }

    const conversation = state.conversation ?? [];
    const bot = state.bot as BotInfo;
    const toolResults = await Promise.all(
      state.toolRequests.map((request) => runTool(request, bot))
    );

    const contentBlocks: ContentBlock[] = toolResults.map((result) => ({
      toolResult: result,
    }));

    const toolResultMessage: Message = {
      role: ConversationRole.USER,
      content: contentBlocks,
    };

    const updatedConversation = [...conversation, toolResultMessage];

    const updatedCommandInput: ConverseStreamCommandInput = {
      ...commandInput,
      messages: updatedConversation,
    };

    return {
      conversation: updatedConversation,
      commandInput: updatedCommandInput,
      toolRequests: undefined,
      stopReason: undefined,
    };
  });

  workflow.addEdge('loadBot', 'prepareConversation');
  workflow.addEdge('prepareConversation', 'invokeModel');

  workflow.addConditionalEdge(
    'invokeModel',
    async (state) => {
      if (
        state.stopReason === StopReason.TOOL_USE &&
        state.toolRequests &&
        state.toolRequests.length > 0
      ) {
        return 'tool_use';
      }
      return 'end';
    },
    {
      tool_use: 'executeTools',
      end: END,
    }
  );

  workflow.addEdge('executeTools', 'invokeModel');

  return workflow.compile();
})();

const waitForQueue = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const chatbotApi: ApiInterface = {
  invoke: async () => {
    throw new Error('Chatbot invoke is not supported. Please use invokeStream.');
  },
  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ) {
    const botId = model.modelParameters?.chatbotConfig?.botId;

    if (!botId) {
      throw new Error('chatbotConfig.botId is required for chatbot API.');
    }

    const queue: string[] = [];
    let isCompleted = false;

    const emit = (chunk: string) => {
      queue.push(chunk);
    };

    chatbotWorkflow
      .invoke(
        {
          inputMessages: messages.map((msg) => ({ ...msg })),
          emit,
        },
        {
          model,
          botId,
          requestId: id,
        }
      )
      .then((state) => {
        queue.push(
          streamingChunk({
            text: '',
            stopReason: state.stopReason ?? StopReason.END_TURN,
            metadata: state.metadata,
          })
        );
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unexpected chatbot error';
        queue.push(
          streamingChunk({
            text: message,
            stopReason: 'error',
          })
        );
      })
      .finally(() => {
        isCompleted = true;
      });

    while (!isCompleted || queue.length > 0) {
      if (queue.length === 0) {
        await waitForQueue(20);
        continue;
      }

      const nextChunk = queue.shift();
      if (nextChunk) {
        yield nextChunk;
      }
    }
  },
  generateImage: async () => {
    throw new Error('Chatbot API does not support image generation.');
  },
  generateVideo: async () => {
    throw new Error('Chatbot API does not support video generation.');
  },
};

export default chatbotApi;

async function getBotInfo(botId: string): Promise<BotInfo> {
  if (!BOT_TABLE_NAME) {
    throw new Error('Bot table is not configured.');
  }

  const input: QueryCommandInput = {
    TableName: BOT_TABLE_NAME,
    IndexName: 'BotIdIndex',
    KeyConditionExpression: '#botId = :botId',
    ExpressionAttributeNames: {
      '#botId': 'BotId',
    },
    ExpressionAttributeValues: {
      ':botId': botId,
    },
    Limit: 1,
  };

  const result = await dynamoDbDocumentClient.send(new QueryCommand(input));

  const item = result.Items?.[0];
  if (!item) {
    throw new Error(`Bot ${botId} was not found.`);
  }

  const generationParams = normalizeGenerationParams(item.GenerationParams);
  const knowledgeBase = resolveKnowledgeBase(item.BedrockKnowledgeBase);
  const knowledgeDescription = buildKnowledgeDescription(item.Knowledge);

  return {
    botId,
    title: item.Title,
    instruction: item.Instruction,
    generationParams,
    knowledgeBase,
    knowledgeDescription,
  };
}

function normalizeGenerationParams(raw: any): BotInfo['generationParams'] {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  return {
    maxTokens: coerceNumber(raw.maxTokens ?? raw.max_tokens),
    temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
    topP: typeof raw.topP === 'number'
      ? raw.topP
      : typeof raw.top_p === 'number'
      ? raw.top_p
      : undefined,
  };
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveKnowledgeBase(raw: any): BotKnowledgeBaseConfig | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const knowledgeBaseId =
    raw.existKnowledgeBaseId ||
    raw.exist_knowledge_base_id ||
    raw.knowledgeBaseId ||
    raw.knowledge_base_id;

  if (!knowledgeBaseId || typeof knowledgeBaseId !== 'string') {
    return undefined;
  }

  const searchParams = raw.searchParams || raw.search_params || {};
  const searchTypeRaw = searchParams.searchType || searchParams.search_type;
  const maxResults = coerceNumber(
    searchParams.maxResults ?? searchParams.max_results
  );

  return {
    knowledgeBaseId,
    maxResults,
    searchType: normalizeSearchType(searchTypeRaw),
  };
}

function normalizeSearchType(value: unknown):
  | BotKnowledgeBaseConfig['searchType']
  | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const upper = value.toUpperCase();
  if (upper === 'SEMANTIC' || upper === 'HYBRID') {
    return upper;
  }
  return undefined;
}

function buildKnowledgeDescription(raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const buildSection = (
    tag: string,
    valueTag: string,
    values: unknown[]
  ): string => {
    const normalized = Array.isArray(values)
      ? values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      : [];
    const inner = normalized
      .map((value) => `<${valueTag}>${value}</${valueTag}>`)
      .join('');
    return `<${tag}>${inner}</${tag}>`;
  };

  const sourceUrls = buildSection('source_urls', 'url', raw.source_urls ?? []);
  const sitemapUrls = buildSection('sitemap_urls', 'url', raw.sitemap_urls ?? []);
  const filenames = buildSection('filenames', 'filename', raw.filenames ?? []);
  const s3Urls = buildSection('s3_urls', 'url', raw.s3_urls ?? []);

  return `${sourceUrls}${sitemapUrls}${filenames}${s3Urls}`;
}

function prepareMessages(
  messages: UnrecordedMessage[],
  instruction?: string
): UnrecordedMessage[] {
  const prepared: UnrecordedMessage[] = [];

  if (instruction) {
    prepared.push({ role: 'system', content: instruction });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    prepared.push({ ...message });
  }

  return prepared;
}

function buildInstruction(
  messages: UnrecordedMessage[],
  bot: BotInfo
): string | undefined {
  const systemMessages = messages
    .filter((msg) => msg.role === 'system' && msg.content)
    .map((msg) => msg.content);

  const parts = [
    ...systemMessages,
    bot.instruction,
  ].filter((value): value is string => Boolean(value && value.trim()));

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('\n\n');
}

function mergeToolConfiguration(
  base: ToolConfiguration | undefined,
  addition: ToolConfiguration
): ToolConfiguration {
  if (!base) {
    return addition;
  }

  const baseTools = base.tools ?? [];
  const additionTools = addition.tools ?? [];
  return {
    ...base,
    ...addition,
    tools: [...baseTools, ...additionTools],
  };
}

function buildToolConfiguration(bot: BotInfo): ToolConfiguration | undefined {
  if (!bot.knowledgeBase) {
    return undefined;
  }

  const description = bot.knowledgeDescription
    ? `Answer a user's question using information. The description is: ${bot.knowledgeDescription}`
    : "Answer a user's question using the bot's knowledge base.";

  const tool: Tool = {
    toolSpec: {
      name: 'knowledge_base_tool',
      description,
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Input suitable for vector search, full text search, and hybrid search. When searching continuously, ensure the query does not duplicate past contexts.',
            },
          },
          required: ['query'],
        },
      },
    },
  };

  return {
    tools: [tool],
  };
}

function buildAssistantMessage(current: {
  role: ConversationRole | undefined;
  contents: Map<number, PartialContent>;
}): Message | undefined {
  if (current.contents.size === 0) {
    return undefined;
  }

  const orderedContents = Array.from(current.contents.entries()).sort(
    ([indexA], [indexB]) => indexA - indexB
  );

  const contentBlocks = orderedContents.reduce<ContentBlock[]>(
    (accumulator, [, content]) => {
      if (content.type === 'text') {
        if (content.text) {
          accumulator.push({ text: content.text });
        }
        return accumulator;
      }

      if (content.type === 'toolUse') {
        accumulator.push({
          toolUse: {
            toolUseId: content.toolUseId,
            name: content.name,
            input: (content.parsedInput ?? {}) as any,
          },
        });
        return accumulator;
      }

      return accumulator;
    },
    []
  );

  if (contentBlocks.length === 0) {
    return undefined;
  }

  return {
    role: current.role ?? ConversationRole.ASSISTANT,
    content: contentBlocks,
  };
}

async function runTool(
  request: ToolRequest,
  bot: BotInfo
): Promise<ToolResultBlock> {
  switch (request.name) {
    case 'knowledge_base_tool':
      return await runKnowledgeBaseTool(request, bot);
    default:
      console.warn(`Unknown tool requested: ${request.name}`);
      return {
        toolUseId: request.toolUseId,
        status: ToolResultStatus.ERROR,
        content: [
          {
            text: `Unsupported tool: ${request.name}`,
          },
        ],
      };
  }
}

async function runKnowledgeBaseTool(
  request: ToolRequest,
  bot: BotInfo
): Promise<ToolResultBlock> {
  if (!bot.knowledgeBase) {
    return {
      toolUseId: request.toolUseId,
      status: ToolResultStatus.ERROR,
      content: [
        {
          text: 'Knowledge base is not configured for this bot.',
        },
      ],
    };
  }

  const query =
    typeof request.input?.query === 'string' ? request.input.query.trim() : '';

  if (!query) {
    return {
      toolUseId: request.toolUseId,
      status: ToolResultStatus.ERROR,
      content: [
        {
          text: 'Tool input is missing the "query" field.',
        },
      ],
    };
  }

  const agentClient = await initBedrockAgentRuntimeClient({
    region: MODEL_REGION,
  });

  type VectorSearchConfiguration = NonNullable<
    NonNullable<RetrieveCommandInput['retrievalConfiguration']>['vectorSearchConfiguration']
  >;

  const vectorSearchConfiguration: VectorSearchConfiguration = {};

  if (bot.knowledgeBase.maxResults) {
    vectorSearchConfiguration.numberOfResults = bot.knowledgeBase.maxResults;
  }

  if (bot.knowledgeBase.searchType) {
    vectorSearchConfiguration.overrideSearchType = bot.knowledgeBase.searchType;
  }

  const baseInput: RetrieveCommandInput = {
    knowledgeBaseId: bot.knowledgeBase.knowledgeBaseId,
    retrievalQuery: { text: query },
  };

  if (Object.keys(vectorSearchConfiguration).length > 0) {
    baseInput.retrievalConfiguration = {
      vectorSearchConfiguration,
    };
  }

  try {
    const response = await retrieveWithFallback(agentClient, baseInput);
    const results = Array.isArray(response.retrievalResults)
      ? response.retrievalResults
      : [];

    const formatted = formatKnowledgeResults(results);

    const contentBlocks: ToolResultContentBlock[] = formatted.length
      ? formatted.map((text) => ({ text }))
      : [
          {
            text: 'No relevant knowledge base documents were found.',
          },
        ];

    return {
      toolUseId: request.toolUseId,
      status: ToolResultStatus.SUCCESS,
      content: contentBlocks,
    };
  } catch (error) {
    console.error('Failed to run knowledge base tool', error);
    const message =
      error instanceof Error ? error.message : 'Knowledge base search failed.';
    return {
      toolUseId: request.toolUseId,
      status: ToolResultStatus.ERROR,
      content: [
        {
          text: message,
        },
      ],
    };
  }
}

async function retrieveWithFallback(
  client: Awaited<ReturnType<typeof initBedrockAgentRuntimeClient>>,
  input: RetrieveCommandInput
) {
  try {
    return await client.send(new RetrieveCommand(input));
  } catch (error) {
    const shouldRetry =
      !!input.retrievalConfiguration?.vectorSearchConfiguration
        ?.overrideSearchType && isValidationException(error);

    if (!shouldRetry) {
      throw error;
    }

    const fallbackInput: RetrieveCommandInput = {
      ...input,
      retrievalConfiguration: input.retrievalConfiguration
        ? {
            vectorSearchConfiguration: {
              ...input.retrievalConfiguration.vectorSearchConfiguration,
            },
          }
        : undefined,
    };

    if (fallbackInput.retrievalConfiguration?.vectorSearchConfiguration) {
      delete fallbackInput.retrievalConfiguration.vectorSearchConfiguration
        .overrideSearchType;
    }

    return await client.send(new RetrieveCommand(fallbackInput));
  }
}

function isValidationException(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = (error as { name?: string }).name;
    return name === 'ValidationException';
  }
  return false;
}

function formatKnowledgeResults(results: any[]): string[] {
  return results
    .map((result, index) => {
      const text =
        typeof result?.content?.text === 'string'
          ? result.content.text.trim()
          : '';

      const { label, link } = extractKnowledgeSource(result?.location);
      const pageNumber = extractPageNumber(result?.metadata);

      const lines: string[] = [`Result ${index + 1}`];
      if (label) {
        lines.push(`Source: ${label}`);
      }
      if (link && link !== label) {
        lines.push(`Link: ${link}`);
      }
      if (pageNumber !== undefined) {
        lines.push(`Page: ${pageNumber}`);
      }
      if (text) {
        lines.push(`Excerpt: ${text}`);
      }

      return lines.join('\n');
    })
    .filter((value) => value && value.trim().length > 0);
}

function extractKnowledgeSource(location: any): {
  label?: string;
  link?: string;
} {
  if (!location || typeof location !== 'object') {
    return {};
  }

  const type = typeof location.type === 'string' ? location.type.toUpperCase() : '';

  switch (type) {
    case 'WEB': {
      const url = location.webLocation?.url;
      return url ? { label: url, link: url } : {};
    }
    case 'S3': {
      const uri = location.s3Location?.uri;
      if (!uri || typeof uri !== 'string') {
        return {};
      }
      const label = uri.split('/').pop() || uri;
      return { label, link: uri };
    }
    case 'CONFLUENCE': {
      const url = location.confluenceLocation?.url;
      return url ? { label: url, link: url } : {};
    }
    case 'SALESFORCE': {
      const url = location.salesforceLocation?.url;
      return url ? { label: url, link: url } : {};
    }
    case 'SHAREPOINT': {
      const url = location.sharePointLocation?.url;
      return url ? { label: url, link: url } : {};
    }
    case 'KENDRA': {
      const url = location.kendraDocumentLocation?.uri;
      return url ? { label: url, link: url } : {};
    }
    default:
      return {};
  }
}

function extractPageNumber(metadata: any): number | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const value = metadata['x-amz-bedrock-kb-document-page-number'];
  const parsed = coerceNumber(value);
  return parsed !== undefined ? Math.trunc(parsed) : undefined;
}

