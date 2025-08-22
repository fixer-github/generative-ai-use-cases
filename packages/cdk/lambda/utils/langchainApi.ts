/*
 * TODO: 現状の問題点
 * - LLMの応答取得に例外処理がない
 * - マルチモーダルに対応していない
 * - StreamingのStopReasonが応答終了以外に対応していない
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  Model,
  UnrecordedMessage,
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
} from 'generative-ai-use-cases';
import { Err, Ok, Result } from './result';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import {
  ConfigurableChatModelCallOptions,
  ConfigurableModel,
  initChatModel,
} from 'langchain/chat_models/universal';
import { BaseLanguageModelInput } from '@langchain/core/language_models/base';

const createModel = async (
  model: Model
): Promise<
  Result<
    ConfigurableModel<BaseLanguageModelInput, ConfigurableChatModelCallOptions>,
    Error
  >
> => {
  try {
    const llm = await initChatModel(model.modelId);
    return Ok(llm);
  } catch (err) {
    return Err(err as Error);
  }
};

const convertMessages = (messages: UnrecordedMessage[]) => {
  const convert = (message: UnrecordedMessage) => {
    switch (message.role) {
      case 'system':
        return new SystemMessage(message.content);
      case 'user':
        return new HumanMessage(message.content);
      case 'assistant':
        return new AIMessage(message.content);
    }
  };

  return messages.map((message) => convert(message));
};

const langchainApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    const createLlmResult = await createModel(model);

    if (!createLlmResult.ok) {
      throw new Error(
        `Failed to create LangChain model:${createLlmResult.error}`
      );
    }
    const llm = createLlmResult.value;
    const langchainMessages = convertMessages(messages);

    const response = await llm.invoke(langchainMessages);

    return response.text;
  },
  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    const createLlmResult = await createModel(model);

    if (!createLlmResult.ok) {
      throw new Error(
        `Failed to create LangChain model:${createLlmResult.error}`
      );
    }
    const llm = createLlmResult.value;
    const langchainMessages = convertMessages(messages);

    const stream = await llm.stream(langchainMessages);

    for await (const chunk of stream) {
      yield streamingChunk({
        text: chunk.text,
      });
    }

    yield streamingChunk({
      text: '',
      stopReason: StopReason.END_TURN,
    });
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

export default langchainApi;
