/*
 * TODO: 現状の問題点
 * - LLMの応答取得に例外処理がない
 * - マルチモーダルに対応していない
 * - StreamingのStopReasonが応答終了以外に対応していない
 */
import { ChatBedrockConverse } from '@langchain/aws';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai';
import {
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import { Err, Ok, Result } from './result';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';

// TODO: クレデンシャル系をどうにかする
const createModel = (model: Model): Result<BaseChatModel, Error> => {
  switch (model.type) {
    case 'bedrock':
      return Ok(new ChatBedrockConverse());
    case 'openai':
      return Ok(new ChatOpenAI());
    case 'google-vertexai':
      return Ok(new ChatVertexAI());
    case 'azure-openai':
      return Ok(new AzureChatOpenAI());
    default:
      return Err(new Error('Unknown model'));
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
    const createLlmResult = createModel(model);

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
    const createLlmResult = createModel(model);

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
