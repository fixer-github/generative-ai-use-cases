import {
  ConverseInferenceParams,
  Model,
  UnrecordedMessage,
  UsecaseConverseInferenceParams,
} from 'generative-ai-use-cases';

class NotImplementedError extends Error {
  constructor() {
    super('Not implemented');
  }
}

export const Invoke = async (
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): Promise<string> => {
  throw new NotImplementedError();
};

async function CreateConverseCommandInput(
  messages: UnrecordedMessage[],
  id: string,
  model: Model,
  defaultConverseInferenceParams: ConverseInferenceParams,
  usecaseConverseInferenceParams: UsecaseConverseInferenceParams
) {
  throw new NotImplementedError();
}

class LiteLlmClient {
  constructor() {
    //
  }
}
