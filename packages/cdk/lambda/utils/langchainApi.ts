/*
 * TODO: 現状の問題点
 * - StreamingのStopReasonが応答終了以外に対応していない
 * - S3からの入力に対応していない（どこで使っているのかが分からない）
 */
import {
  Model,
  UnrecordedMessage,
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  ExtraData,
} from 'generative-ai-use-cases';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  DataContentBlock,
} from '@langchain/core/messages';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import { initChatModel } from 'langchain/chat_models/universal';

const convertExtraData = (extraData: ExtraData): DataContentBlock => {
  const { type: dataType, name, source } = extraData;
  const { type: sourceType, mediaType, data } = source;

  switch (sourceType) {
    case 's3':
      throw new Error('Not implemented');
    case 'base64':
      switch (dataType) {
        case 'image':
          return {
            type: 'image',
            source_type: 'base64',
            mime_type: mediaType,
            data: data,
          };
        case 'file':
          return {
            type: 'file',
            source_type: 'base64',
            mime_type: mediaType,
            data: data,
            metadata: {
              filename: name,
            },
          };
        case 'json':
          return {
            type: 'text',
            source_type: 'text',
            mime_type: mediaType,
            text: data,
          };
        case 'video':
          throw new Error('Video input is not supported currently.');
      }
    case 'json':
      return {
        type: 'text',
        source_type: 'text',
        mime_type: mediaType,
        text: data,
      };
  }
};

const convertToHumanMessage = (message: UnrecordedMessage) => {
  if (message.extraData) {
    const extraContents = message.extraData.map((data) =>
      convertExtraData(data)
    );

    return new HumanMessage({
      content: [
        {
          type: 'text',
          text: message.content,
        },
        ...extraContents,
      ],
    });
  }
  return new HumanMessage(message.content);
};

const convertSingleMessage = (message: UnrecordedMessage) => {
  switch (message.role) {
    case 'system':
      return new SystemMessage(message.content);
    case 'user':
      return convertToHumanMessage(message);
    case 'assistant':
      return new AIMessage(message.content);
  }
};

const convertMessages = (messages: UnrecordedMessage[]) => {
  return messages.map((message) => convertSingleMessage(message));
};

const langchainApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    const llm = await initChatModel(model.modelId);
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
    const llm = await initChatModel(model.modelId);
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
