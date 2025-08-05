import {
  ApiInterface,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import { streamingChunk } from './streamingChunk';
import { StopReason } from '@aws-sdk/client-bedrock-runtime';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

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
    case 'tool_calls':
    case 'function_call':
      return StopReason.TOOL_USE;
    case 'content_filter':
      return StopReason.CONTENT_FILTERED;
    default:
      return 'error';
  }
};

const createSignedRequest = async (endpoint: string, body: any) => {
  console.log('[createSignedRequest] Starting request creation');
  console.log('[createSignedRequest] Endpoint:', endpoint);
  console.log('[createSignedRequest] Body:', JSON.stringify(body, null, 2));
  
  const url = new URL(endpoint);
  const hostname = url.hostname;
  const pathname = url.pathname;
  
  console.log('[createSignedRequest] Parsed URL:');
  console.log('  - Hostname:', hostname);
  console.log('  - Pathname:', pathname);

  const request = new HttpRequest({
    hostname,
    path: pathname,
    method: 'POST',
    headers: {
      host: hostname,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  console.log('[createSignedRequest] Initial request headers:', request.headers);

  try {
    const credentials = await defaultProvider()();
    console.log('[createSignedRequest] Got AWS credentials:');
    console.log('  - AccessKeyId:', credentials.accessKeyId);
    console.log('  - SessionToken:', credentials.sessionToken ? 'Present' : 'Not present');
    console.log('  - Region:', process.env.AWS_REGION || 'us-east-1');

    const signer = new SignatureV4({
      credentials,
      region: process.env.AWS_REGION || 'us-east-1',
      service: 'lambda',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);
    console.log('[createSignedRequest] Signed request headers:', signedRequest.headers);
    
    return signedRequest;
  } catch (error) {
    console.error('[createSignedRequest] Error during signing:', error);
    throw error;
  }
};

// Debug: Log environment information at module load time
console.log('[liteLlmApi] Module loaded with environment:');
console.log('  - AWS_REGION:', process.env.AWS_REGION);
console.log('  - AWS_LAMBDA_FUNCTION_NAME:', process.env.AWS_LAMBDA_FUNCTION_NAME);
console.log('  - LITELLM_ENDPOINT:', process.env.LITELLM_ENDPOINT);
console.log('  - AWS_EXECUTION_ENV:', process.env.AWS_EXECUTION_ENV);

const liteLlmApi: ApiInterface = {
  invoke: async function (
    model: Model,
    messages: UnrecordedMessage[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _id: string
  ): Promise<string> {
    console.log('[invoke] Starting non-stream request');
    console.log('[invoke] Model:', model.modelId);
    console.log('[invoke] Messages count:', messages.length);
    
    const litellmEndpoint = process.env.LITELLM_ENDPOINT;
    console.log('[invoke] LITELLM_ENDPOINT:', litellmEndpoint);
    
    if (!litellmEndpoint) {
      throw new Error('LITELLM_ENDPOINT environment variable is not set');
    }

    const openAIMessages = createOpenAIChatCompletionMessages(messages);
    const requestBody = {
      model: model.modelId,
      messages: openAIMessages,
      stream: false,
    };

    console.log('[invoke] Creating signed request...');
    const signedRequest = await createSignedRequest(litellmEndpoint, requestBody);

    console.log('[invoke] Sending request to:', litellmEndpoint);
    console.log('[invoke] Request method:', signedRequest.method);
    console.log('[invoke] Final headers:', JSON.stringify(signedRequest.headers, null, 2));
    console.log('[invoke] Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(litellmEndpoint, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: JSON.stringify(requestBody),
    });

    console.log('[invoke] Response status:', response.status);
    console.log('[invoke] Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[invoke] Error response body:', errorText);
      console.error('[invoke] Full error details:');
      console.error('  - Status:', response.status);
      console.error('  - StatusText:', response.statusText);
      console.error('  - URL:', response.url);
      throw new Error(`LiteLLM API request failed: ${response.status} - ${errorText}`);
    }

    const completion = await response.json();
    console.log('[invoke] Success! Response:', JSON.stringify(completion, null, 2));
    return completion.choices[0].message.content ?? '';
  },
  invokeStream: async function* (
    model: Model,
    messages: UnrecordedMessage[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _id: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _idToken?: string | undefined
  ): AsyncIterable<string> {
    console.log('[invokeStream] Starting stream request');
    console.log('[invokeStream] Model:', model.modelId);
    console.log('[invokeStream] Messages count:', messages.length);
    
    const litellmEndpoint = process.env.LITELLM_ENDPOINT;
    console.log('[invokeStream] LITELLM_ENDPOINT:', litellmEndpoint);
    
    if (!litellmEndpoint) {
      throw new Error('LITELLM_ENDPOINT environment variable is not set');
    }

    const openAIMessages = createOpenAIChatCompletionMessages(messages);
    const requestBody = {
      model: model.modelId,
      messages: openAIMessages,
      stream: true,
    };

    console.log('[invokeStream] Creating signed request...');
    const signedRequest = await createSignedRequest(litellmEndpoint, requestBody);

    console.log('[invokeStream] Sending request to:', litellmEndpoint);
    console.log('[invokeStream] Request method:', signedRequest.method);
    console.log('[invokeStream] Final headers:', JSON.stringify(signedRequest.headers, null, 2));
    console.log('[invokeStream] Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(litellmEndpoint, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: JSON.stringify(requestBody),
    });

    console.log('[invokeStream] Response status:', response.status);
    console.log('[invokeStream] Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[invokeStream] Error response body:', errorText);
      console.error('[invokeStream] Full error details:');
      console.error('  - Status:', response.status);
      console.error('  - StatusText:', response.statusText);
      console.error('  - URL:', response.url);
      throw new Error(`LiteLLM API request failed: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield streamingChunk({
                text: '',
                stopReason: StopReason.STOP_SEQUENCE,
              });
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              
              if (choice?.finish_reason) {
                const stopReason = convertFinishReason(choice.finish_reason);
                yield streamingChunk({
                  text: '',
                  stopReason: stopReason,
                });
              } else if (choice?.delta?.content) {
                yield streamingChunk({
                  text: choice.delta.content,
                });
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
  generateImage: function (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _model: Model,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _params: GenerateImageParams
  ): Promise<string> {
    throw new Error('Function not implemented.');
  },
  generateVideo: function (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _model: Model,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _params: GenerateVideoParams
  ): Promise<string> {
    throw new Error('Function not implemented.');
  },
};

export default liteLlmApi;