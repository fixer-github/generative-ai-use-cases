import {
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';

const liteLlmClient: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string
  ): Promise<string> {
    throw new Error('Function not implemented.');
  },
  invokeStream: function (
    model: Model,
    messages: UnrecordedMessage[],
    id: string,
    idToken?: string | undefined
  ): AsyncIterable<string> {
    throw new Error('Function not implemented.');
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
