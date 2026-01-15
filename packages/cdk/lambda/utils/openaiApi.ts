import OpenAI, { APIError } from 'openai';
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
 * @throws APIキーが設定されていない場合にエラーをスロー
 */
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey.trim() === '') {
    console.error('OPENAI_API_KEY environment variable is not set');
    throw new Error(
      'OpenAI API key is not configured. Please set the OPENAI_API_KEY environment variable.'
    );
  }

  return new OpenAI({ apiKey });
}

/**
 * S3からファイルを取得してBase64形式で返す
 * @param extraData 対象のデータ
 * @returns Base64形式のデータ
 * @throws ファイル取得に失敗した場合にユーザー向けエラーをスロー
 */
async function getS3FileAsBase64(extraData: ExtraData): Promise<string> {
  console.debug('Get data from S3');

  const bucketName = process.env.BUCKET_NAME;
  if (!bucketName) {
    console.error('BUCKET_NAME environment variable is not set');
    throw new Error(
      'File storage is not configured. Please contact the administrator.'
    );
  }

  const s3Client = new S3Client();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: extraData.source.data,
  });

  try {
    const response = await s3Client.send(command);
    if (!response.Body) {
      console.error('S3 GetObject returned empty body', {
        bucket: bucketName,
        key: extraData.source.data,
      });
      throw new Error('Failed to retrieve file content.');
    }

    const sdkStream = sdkStreamMixin(response.Body);
    const data = await sdkStream.transformToByteArray();

    return Buffer.from(data).toString('base64');
  } catch (e) {
    const errorName = (e as Error)?.name;
    console.error('S3 GetObject failed:', {
      bucket: bucketName,
      key: extraData.source.data,
      errorName,
      errorMessage: e instanceof Error ? e.message : String(e),
    });

    if (errorName === 'NoSuchKey') {
      throw new Error(
        'The attached file could not be found. Please try uploading it again.'
      );
    }
    if (errorName === 'AccessDenied') {
      throw new Error(
        'Access to the file was denied. Please contact the administrator.'
      );
    }
    // 既にユーザー向けにスローされたエラーはそのまま再スロー
    if (
      e instanceof Error &&
      e.message.includes('Failed to retrieve file content')
    ) {
      throw e;
    }
    throw new Error('Failed to retrieve the attached file. Please try again.');
  }
}

/**
 * ExtraDataがS3のURLを指していたときにBase64形式に変換するヘルパー
 * @param extraData 対象のデータ
 * @returns Base64あるいはText形式のデータ
 */
function getTextDataFromExtraData(extraData: ExtraData): Promise<string> {
  if (extraData.source.type === 's3') {
    return getS3FileAsBase64(extraData);
  }
  return Promise.resolve(extraData.source.data);
}

/**
 * ExtraDataをOpenAI用のコンテンツブロックに変換する
 * @param extraData 対象のデータ
 * @returns OpenAI用のコンテンツブロック
 */
async function convertExtraData(
  extraData: ExtraData
): Promise<ChatCompletionContentPart> {
  const { type: dataType, source } = extraData;
  const { mediaType } = source;

  const data = await getTextDataFromExtraData(extraData);

  if (source.type === 'json' || dataType === 'json') {
    return { type: 'text', text: data };
  }

  if (dataType === 'video') {
    throw new Error('Video input is not supported currently.');
  }

  // image, file の場合は image_url として返す
  return {
    type: 'image_url',
    image_url: { url: `data:${mediaType};base64,${data}` },
  };
}

/**
 * UnrecordedMessageをOpenAI用のメッセージに変換する
 * OpenAIの型定義では、userメッセージのみcontentに配列を受け付ける
 * @param message 変換元のメッセージ
 * @returns OpenAI用のメッセージ
 */
async function convertToOpenAIMessage(
  message: UnrecordedMessage
): Promise<ChatCompletionMessageParam> {
  const { role, content, extraData } = message;

  // userメッセージで追加データがある場合のみ配列形式を使用
  if (role === 'user' && extraData && extraData.length > 0) {
    const extraParts = await Promise.all(extraData.map(convertExtraData));
    const contentParts: ChatCompletionContentPart[] = [
      { type: 'text', text: content },
      ...extraParts,
    ];

    return { role: 'user', content: contentParts };
  }

  // system, assistant, または追加データのないuserメッセージは文字列形式
  return { role, content } as ChatCompletionMessageParam;
}

/**
 * 会話履歴をOpenAI用の形式に変換する
 * @param messages 変換元の会話履歴
 * @returns OpenAI用の会話履歴
 */
function convertMessages(
  messages: UnrecordedMessage[]
): Promise<ChatCompletionMessageParam[]> {
  return Promise.all(messages.map(convertToOpenAIMessage));
}

/**
 * OpenAIのfinish_reasonをStopReasonに変換する
 * @param reason OpenAIのfinish_reason
 * @returns StopReason
 */
function convertFinishReason(
  reason: string | null | undefined
): StopReason | undefined {
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
}

/**
 * OpenAI APIエラーをユーザー向けメッセージに変換する
 * @param error OpenAI APIエラー
 * @param modelId モデルID
 * @returns ユーザー向けエラーメッセージ
 */
function getApiErrorMessage(error: APIError, modelId: string): string {
  switch (error.status) {
    case 401:
      return 'OpenAI API key is invalid or not configured. Please check the OPENAI_API_KEY environment variable.';
    case 429:
      return 'OpenAI API rate limit exceeded. Please try again later.';
    case 404:
      return `Model '${modelId}' is not available. Please select a different model.`;
    default:
      return `OpenAI API error: ${error.message}`;
  }
}

const openaiApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    // modelId形式: "openai:gpt-4o" -> "gpt-4o"
    const modelId = model.modelId.replace('openai:', '');

    try {
      const openai = getOpenAIClient();
      const openAIMessages = await convertMessages(messages);

      console.debug('Processing messages', { count: messages.length, modelId });

      const response = await openai.chat.completions.create({
        model: modelId,
        messages: openAIMessages,
      });

      if (!response.choices || response.choices.length === 0) {
        console.error('OpenAI API returned no choices', { modelId });
        throw new Error('OpenAI API returned no response choices');
      }

      const choice = response.choices[0];
      const content = choice.message?.content;

      if (content === null || content === undefined) {
        if (choice.finish_reason === 'content_filter') {
          console.warn('OpenAI content filter triggered', { modelId });
          throw new Error(
            'The response was blocked by content filtering. Please rephrase your request.'
          );
        }
        console.error('OpenAI API returned null content', {
          modelId,
          finishReason: choice.finish_reason,
        });
        throw new Error('OpenAI API returned empty response');
      }

      return content;
    } catch (e) {
      if (e instanceof APIError) {
        console.error('OpenAI API Error:', {
          status: e.status,
          message: e.message,
          code: e.code,
          modelId,
        });
        throw new Error(getApiErrorMessage(e, modelId));
      }
      throw e;
    }
  },

  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    // modelId形式: "openai:gpt-4o" -> "gpt-4o"
    const modelId = model.modelId.replace('openai:', '');

    try {
      const openai = getOpenAIClient();
      const openAIMessages = await convertMessages(messages);

      console.debug('Processing messages', { count: messages.length, modelId });

      const stream = await openai.chat.completions.create({
        model: modelId,
        messages: openAIMessages,
        stream: true,
      });

      let stopReasonSent = false;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield streamingChunk({ text: content });
        }

        const finishReason = chunk.choices[0]?.finish_reason;
        const stopReason = finishReason
          ? convertFinishReason(finishReason)
          : undefined;
        if (stopReason) {
          yield streamingChunk({ text: '', stopReason });
          stopReasonSent = true;
        }
      }

      // finish_reasonが送信されなかった場合のみ終了を通知
      if (!stopReasonSent) {
        yield streamingChunk({
          text: '',
          stopReason: StopReason.END_TURN,
        });
      }
    } catch (e) {
      let errorMessage: string;

      if (e instanceof APIError) {
        errorMessage = getApiErrorMessage(e, modelId);
      } else {
        // 内部エラーの詳細はログにのみ記録し、ユーザーには汎用メッセージを表示
        console.error('Unexpected error in OpenAI invokeStream:', {
          modelId,
          errorType: e?.constructor?.name,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
        errorMessage =
          'An unexpected error occurred. Please try again later.';
      }

      console.error('OpenAI API call error:', e);
      yield streamingChunk({
        text: errorMessage,
        stopReason: 'error',
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

export default openaiApi;
