import {
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import OpenAI from 'openai';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';

const initOpenAIClient = () => {
  return new OpenAI({
    baseURL: 'http://localhost:4000', // TODO: あとでどうにかする
    apiKey: '',
  });
};

const createOpenAIChatCompletionMessages = (messages: UnrecordedMessage[]) => {
  return messages.map((message) => {
    return {
      role: message.role,
      content: message.content,
    };
  });
};

const convertFinishReason = (
  reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call'
) => {
  switch (reason) {
    case 'stop':
      return StopReason.STOP_SEQUENCE;
    case 'length':
      return StopReason.MAX_TOKENS;
    case 'tool_calls' || 'function_call':
      return StopReason.TOOL_USE;
    case 'content_filter':
      return StopReason.CONTENT_FILTERED;
    default:
      return 'error';
  }
};

const liteLlmClient: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    const client = initOpenAIClient();

    const openAIMessages = createOpenAIChatCompletionMessages(messages);

    const completion = await client.chat.completions.create({
      model: model.modelId,
      messages: openAIMessages,
    });

    return completion.choices[0].message.content ?? '';
  },
  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    const client = initOpenAIClient();

    const openAIMessages = createOpenAIChatCompletionMessages(messages);

    const completion = await client.chat.completions.create({
      model: model.modelId,
      messages: openAIMessages,
      stream: true,
    });

    for await (const chunk of completion) {
      if (!chunk) {
        break;
      }

      if (chunk.choices[0].finish_reason) {
        const stopReason = convertFinishReason(chunk.choices[0].finish_reason);

        yield streamingChunk({
          text: '',
          stopReason: stopReason,
        });
      }

      yield streamingChunk({
        text: chunk.choices[0].delta.content ?? '',
      });
    }
  },
  generateImage: function (
    model: Model,
    params: GenerateImageParams
  ): Promise<string> {
    throw new Error('Function not implemented.');
  },
  generateVideo: function (
    model: Model,
    params: GenerateVideoParams
  ): Promise<string> {
    throw new Error('Function not implemented.');
  },
};
