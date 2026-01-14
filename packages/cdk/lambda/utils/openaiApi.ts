import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
import {
  Model,
  UnrecordedMessage,
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  ExtraData,
} from 'generative-ai-use-cases';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream-node';

/**
 * OpenAI クライアントを取得する
 */
const getOpenAIClient = (): OpenAI => {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

/**
 * S3からファイルを取得してBase64形式で返す
 * @param extraData 対象のデータ
 * @returns Base64形式のデータ
 */
const getS3FileAsBase64 = async (extraData: ExtraData): Promise<string> => {
  console.debug('Get data from S3');

  const s3Client = new S3Client();

  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: extraData.source.data,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('No body in response');
  }

  const sdkStream = sdkStreamMixin(response.Body);
  const data = await sdkStream.transformToByteArray();

  const base64String = Buffer.from(data).toString('base64');

  return base64String;
};

/**
 * ExtraDataがS3のURLを指していたときにBase64形式に変換するヘルパー
 * @param extraData 対象のデータ
 * @returns Base64あるいはText形式のデータ
 */
const getTextDataFromExtraData = async (
  extraData: ExtraData
): Promise<string> => {
  if (extraData.source.type === 's3') {
    return await getS3FileAsBase64(extraData);
  }

  return extraData.source.data;
};

/**
 * ExtraDataをOpenAI用のコンテンツブロックに変換する
 * @param extraData 対象のデータ
 * @returns OpenAI用のコンテンツブロック
 */
const convertExtraData = async (
  extraData: ExtraData
): Promise<ChatCompletionContentPart> => {
  const { type: dataType, source } = extraData;
  const { type: sourceType, mediaType } = source;

  const data = await getTextDataFromExtraData(extraData);

  if (sourceType === 'json') {
    return {
      type: 'text',
      text: data,
    };
  }

  switch (dataType) {
    case 'image':
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${data}`,
        },
      };
    case 'file':
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${data}`,
        },
      };
    case 'json':
      return {
        type: 'text',
        text: data,
      };
    case 'video':
      throw new Error('Video input is not supported currently.');
  }
};

/**
 * UnrecordedMessageをOpenAI用のメッセージに変換する
 * OpenAIの型定義では、userメッセージのみcontentに配列を受け付ける
 * @param message 変換元のメッセージ
 * @returns OpenAI用のメッセージ
 */
const convertToOpenAIMessage = async (
  message: UnrecordedMessage
): Promise<ChatCompletionMessageParam> => {
  const { role, content, extraData } = message;

  // userメッセージで追加データがある場合のみ配列形式を使用
  if (role === 'user' && extraData && extraData.length > 0) {
    const contentParts: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: content,
      },
    ];

    for (const data of extraData) {
      const convertedData = await convertExtraData(data);
      contentParts.push(convertedData);
    }

    return {
      role: 'user',
      content: contentParts,
    };
  }

  // system, assistant, または追加データのないuserメッセージは文字列形式
  switch (role) {
    case 'system':
      return { role: 'system', content };
    case 'assistant':
      return { role: 'assistant', content };
    case 'user':
    default:
      return { role: 'user', content };
  }
};

/**
 * 会話履歴をOpenAI用の形式に変換する
 * @param messages 変換元の会話履歴
 * @returns OpenAI用の会話履歴
 */
const convertMessages = async (
  messages: UnrecordedMessage[]
): Promise<ChatCompletionMessageParam[]> => {
  return Promise.all(
    messages.map(async (message) => await convertToOpenAIMessage(message))
  );
};

/**
 * OpenAIのfinish_reasonをStopReasonに変換する
 * @param reason OpenAIのfinish_reason
 * @returns StopReason
 */
const convertFinishReason = (
  reason: string | null | undefined
): StopReason | undefined => {
  switch (reason) {
    case 'stop':
      return StopReason.END_TURN;
    case 'length':
      return StopReason.MAX_TOKENS;
    case 'content_filter':
      return StopReason.CONTENT_FILTERED;
    default:
      return undefined;
  }
};

const openaiApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    const openai = getOpenAIClient();
    const openAIMessages = await convertMessages(messages);

    // modelId形式: "openai:gpt-4o" -> "gpt-4o"
    const modelId = model.modelId.replace('openai:', '');

    console.debug(JSON.stringify(messages));

    const response = await openai.chat.completions.create({
      model: modelId,
      messages: openAIMessages,
    });

    return response.choices[0]?.message?.content ?? '';
  },

  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    const openai = getOpenAIClient();
    const openAIMessages = await convertMessages(messages);

    // modelId形式: "openai:gpt-4o" -> "gpt-4o"
    const modelId = model.modelId.replace('openai:', '');

    console.debug(JSON.stringify(messages));

    const stream = await openai.chat.completions.create({
      model: modelId,
      messages: openAIMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield streamingChunk({
          text: content,
        });
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) {
        const stopReason = convertFinishReason(finishReason);
        if (stopReason) {
          yield streamingChunk({
            text: '',
            stopReason: stopReason,
          });
        }
      }
    }

    // ストリーム終了を通知
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

export default openaiApi;
