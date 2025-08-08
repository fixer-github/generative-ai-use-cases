import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from '@aws-sdk/client-lambda';
import {
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  StreamingChunk,
} from 'generative-ai-use-cases';
import { streamingChunk } from './streamingChunk';

const LITELLM_FUNCTION_ARN = process.env.LITELLM_FUNCTION_ARN as string;

const lambda = new LambdaClient({});

const liteLlmApi: Omit<ApiInterface, 'invokeFlow'> = {
  invoke: async (model, messages, id) => {
    const payload = {
      action: 'invoke',
      model: model,
      messages: messages,
      id: id,
    };

    const command = new InvokeCommand({
      FunctionName: LITELLM_FUNCTION_ARN,
      InvocationType: InvocationType.RequestResponse,
      Payload: JSON.stringify(payload),
    });

    try {
      const response = await lambda.send(command);
      const responsePayload = JSON.parse(
        new TextDecoder().decode(response.Payload)
      );

      if (response.StatusCode !== 200 || responsePayload.errorMessage) {
        throw new Error(
          responsePayload.errorMessage || 'LiteLLM invocation failed'
        );
      }

      const result = JSON.parse(responsePayload.body);
      const chunk: StreamingChunk = {
        text: result.content,
        stopReason: result.stopReason || 'end_turn',
      };
      return chunk;
    } catch (error) {
      console.error('LiteLLM invoke error:', error);
      throw error;
    }
  },

  invokeStream: async function* (model, messages, id) {
    const payload = {
      action: 'invoke_stream',
      model: model,
      messages: messages,
      id: id,
    };

    const command = new InvokeCommand({
      FunctionName: LITELLM_FUNCTION_ARN,
      InvocationType: InvocationType.RequestResponse,
      Payload: JSON.stringify(payload),
    });

    try {
      const response = await lambda.send(command);
      const responsePayload = JSON.parse(
        new TextDecoder().decode(response.Payload)
      );

      if (response.StatusCode !== 200 || responsePayload.errorMessage) {
        throw new Error(
          responsePayload.errorMessage || 'LiteLLM stream invocation failed'
        );
      }

      // Parse streaming response
      const streamData = JSON.parse(responsePayload.body);
      
      // Process each chunk from the Lambda response
      for (const chunkData of streamData.chunks) {
        const chunk: StreamingChunk = {
          text: chunkData.content,
          stopReason: chunkData.stopReason,
        };
        yield streamingChunk(chunk);
      }

      // Send final chunk with stop reason
      const finalChunk: StreamingChunk = {
        text: '',
        stopReason: streamData.stopReason || 'end_turn',
      };
      yield streamingChunk(finalChunk);
    } catch (error) {
      console.error('LiteLLM stream error:', error);
      throw error;
    }
  },

  generateImage: async (model: Model, params: GenerateImageParams) => {
    // LiteLLM doesn't support image generation directly
    throw new Error('Image generation is not supported by LiteLLM');
  },

  generateVideo: async (model: Model, params: GenerateVideoParams) => {
    // LiteLLM doesn't support video generation
    throw new Error('Video generation is not supported by LiteLLM');
  },
};

export default liteLlmApi;