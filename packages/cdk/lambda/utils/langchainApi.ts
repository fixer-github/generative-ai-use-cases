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
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import {
  AIMessage,
  HumanMessage,
  initChatModel,
  SystemMessage,
  ContentBlock,
} from 'langchain';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream-node';
import { initBedrockRuntimeClient } from './bedrockClient';

const MODEL_REGION = process.env.MODEL_REGION as string;

// Cache LangChain model instances per modelId+region
const langchainModels: Record<string, any> = {};

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

  // SdkStreamMixinを使用してStreamを変換
  const sdkStream = sdkStreamMixin(response.Body);
  const data = await sdkStream.transformToByteArray();

  // Uint8ArrayをBase64に変換
  const base64String = Buffer.from(data).toString('base64');

  return base64String;
};

/**
 * ExtraDataがS3のURLを指していたときにBase64形式に変換してくれるヘルパー
 * @param extraData 対象のデータ
 * @returns Base64あるいはText形式のデータ
 */
const getTextDataFromExtraData = async (
  extraData: ExtraData
): Promise<string> => {
  if (extraData.source.type === 's3') {
    // S3に保存されている場合はデータを取得してBase64に変換して返す
    return await getS3FileAsBase64(extraData);
  }

  return extraData.source.data;
};

/**
 * ExtraDataをLangChain用のDataContentBlockに変換する
 * @param extraData 対象のデータ
 * @returns LangChain用のDataContentBlock
 */
const convertExtraData = async (
  extraData: ExtraData
): Promise<ContentBlock> => {
  const { type: dataType, name, source } = extraData;
  const { type: sourceType, mediaType } = source;

  const data = await getTextDataFromExtraData(extraData);

  if (sourceType === 'json') {
    return {
      type: 'text',
      source_type: 'text',
      mime_type: mediaType,
      text: data,
    };
  }

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
};

/**
 * Bedrock用のUnrecordedMessageをLangChain用のHumanMessageにいい感じに変換する
 * @param message Bedrock用のメッセージ
 * @returns LangChain用のHumanMessage
 */
const convertToHumanMessage = async (message: UnrecordedMessage) => {
  if (message.extraData) {
    const extraContents = await Promise.all(
      message.extraData.map(async (data) => await convertExtraData(data))
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

/**
 * Bedrock用のメッセージをLangChain用のメッセージに変換してくれる
 * @param message Bedrock用のメッセージ
 * @returns LangChain用のメッセージ
 */
const convertSingleMessage = async (message: UnrecordedMessage) => {
  switch (message.role) {
    case 'system':
      return new SystemMessage(message.content);
    case 'user':
      return await convertToHumanMessage(message);
    case 'assistant':
      return new AIMessage(message.content);
  }
};

/**
 * Bedrock用の会話履歴をLangChain用の会話履歴にいい感じに変換してくれる
 * @param messages Bedrock用の会話履歴
 * @returns LangChain用の会話履歴
 */
const convertMessages = (messages: UnrecordedMessage[]) => {
  return Promise.all(
    messages.map(async (message) => await convertSingleMessage(message))
  );
};

/**
 * LangChainモデルインスタンスを作成またはキャッシュから取得する
 * @param model モデル情報
 * @returns LangChainモデルインスタンス
 */
const createModel = async (model: Model) => {
  const region = model.region || MODEL_REGION;
  const cacheKey = `${model.modelId}-${region}`;

  // キャッシュされたモデルインスタンスがあれば再利用
  if (langchainModels[cacheKey]) {
    console.debug('Reusing cached LangChain model instance:', { modelId: model.modelId, region });
    return langchainModels[cacheKey];
  }

  console.debug('Creating new LangChain model instance:', { modelId: model.modelId, region });

  let llm;
  if (model.modelId.startsWith('bedrock:')) {
    // Bedrockモデルの場合は、bedrock:プレフィックスを除去してモデルIDを取得
    const actualModelId = model.modelId.replace(/^bedrock:/, '');

    // BedrockRuntimeClientを取得
    const bedrockClient = await initBedrockRuntimeClient({ region });

    console.debug('Initializing Bedrock model via LangChain:', {
      originalModelId: model.modelId,
      actualModelId,
      region
    });

    // initChatModelにmodelProviderとclientを渡す
    llm = await initChatModel(actualModelId, {
      modelProvider: 'bedrock',
      client: bedrockClient,
    });
  } else if (model.modelId.startsWith('openai:')) {
    // OpenAIモデルの場合は、openai:プレフィックスを除去
    const actualModelId = model.modelId.replace(/^openai:/, '');

    llm = await initChatModel(actualModelId, {
      modelProvider: 'openai',
    });
  } else {
    // その他のモデル
    llm = await initChatModel(model.modelId);
  }

  // モデルインスタンスをキャッシュ
  langchainModels[cacheKey] = llm;
  return llm;
};

const langchainApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    try {
      const llm = await createModel(model);
      const langchainMessages = await convertMessages(messages);

      console.debug('Invoking LangChain model:', {
        modelId: model.modelId,
        region: model.region || MODEL_REGION,
        messageCount: messages.length,
      });

      const response = await llm.invoke(langchainMessages);

      console.debug('LangChain model response received:', {
        modelId: model.modelId,
        responseLength: response.text?.length || 0,
      });

      return response.text;
    } catch (error) {
      console.error('LangChain invoke error:', {
        modelId: model.modelId,
        region: model.region || MODEL_REGION,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });
      throw error;
    }
  },
  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    try {
      const llm = await createModel(model);
      const langchainMessages = await convertMessages(messages);

      console.debug('Invoking LangChain model (stream):', {
        modelId: model.modelId,
        region: model.region || MODEL_REGION,
        messageCount: messages.length,
      });

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

      console.debug('LangChain model stream completed:', {
        modelId: model.modelId,
      });
    } catch (error) {
      console.error('LangChain invokeStream error:', {
        modelId: model.modelId,
        region: model.region || MODEL_REGION,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined,
      });
      throw error;
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

export default langchainApi;
