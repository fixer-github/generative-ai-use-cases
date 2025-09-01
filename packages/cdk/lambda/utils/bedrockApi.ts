import {
  InvokeModelCommand,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
  ServiceQuotaExceededException,
  ThrottlingException,
  AccessDeniedException,
  StartAsyncInvokeCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  ApiInterface,
  BedrockImageGenerationResponse,
  GenerateImageParams,
  GenerateVideoParams,
  Model,
  StreamingChunk,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import {
  BEDROCK_TEXT_GEN_MODELS,
  BEDROCK_IMAGE_GEN_MODELS,
  BEDROCK_VIDEO_GEN_MODELS,
} from './models';
import { streamingChunk } from './streamingChunk';
import { initBedrockRuntimeClient, initBedrockRuntimeClientWithCredentials } from './bedrockClient';
import { getVideoBucketForGeneration } from './videoBucketUtils';

const MODEL_REGION = process.env.MODEL_REGION as string;

const createConverseCommandInput = (
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): ConverseCommandInput => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.createConverseCommandInput(
    messages,
    id,
    model,
    modelConfig.defaultParams,
    modelConfig.usecaseParams
  );
};

const createConverseStreamCommandInput = (
  model: Model,
  messages: UnrecordedMessage[],
  id: string
): ConverseStreamCommandInput => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.createConverseStreamCommandInput(
    messages,
    id,
    model,
    modelConfig.defaultParams,
    modelConfig.usecaseParams
  );
};

const extractConverseOutput = (
  model: Model,
  output: ConverseCommandOutput
): StreamingChunk => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.extractConverseOutput(output);
};

const extractConverseStreamOutput = (
  model: Model,
  output: ConverseStreamOutput
): StreamingChunk => {
  const modelConfig = BEDROCK_TEXT_GEN_MODELS[model.modelId];
  return modelConfig.extractConverseStreamOutput(output);
};

const createBodyImage = (model: Model, params: GenerateImageParams): string => {
  const modelConfig = BEDROCK_IMAGE_GEN_MODELS[model.modelId];
  return modelConfig.createBodyImage(params);
};

const extractOutputImage = (
  model: Model,
  response: BedrockImageGenerationResponse
): string => {
  const modelConfig = BEDROCK_IMAGE_GEN_MODELS[model.modelId];
  return modelConfig.extractOutputImage(response);
};

const createBodyVideo = (model: Model, params: GenerateVideoParams) => {
  const modelConfig = BEDROCK_VIDEO_GEN_MODELS[model.modelId];
  return modelConfig.createBodyVideo(params);
};

const bedrockApi: Omit<ApiInterface, 'invokeFlow'> = {
  invoke: async (model, messages, id) => {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });

    const converseCommandInput = createConverseCommandInput(
      model,
      messages,
      id
    );
    const command = new ConverseCommand(converseCommandInput);
    const output = await client.send(command);

    return extractConverseOutput(model, output).text;
  },
  invokeStream: async function* (model, messages, id) {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });
    try {
      const converseStreamCommandInput = createConverseStreamCommandInput(
        model,
        messages,
        id
      );

      const command = new ConverseStreamCommand(converseStreamCommandInput);

      const responseStream = await client.send(command);

      if (!responseStream.stream) {
        return;
      }

      for await (const response of responseStream.stream) {
        if (!response) {
          break;
        }

        const output = extractConverseStreamOutput(model, response);

        if (output.text || output.trace || output.metadata) {
          yield streamingChunk({
            text: output.text,
            trace: output.trace,
            metadata: output.metadata,
          });
        }

        if (response.messageStop) {
          yield streamingChunk({
            text: '',
            stopReason: response.messageStop.stopReason,
          });
          // Metadata comes after the stopReason, so we need to keep loop
        }
      }
    } catch (e) {
      if (
        e instanceof ThrottlingException ||
        e instanceof ServiceQuotaExceededException
      ) {
        yield streamingChunk({
          text: 'The server is currently experiencing high access. Please try again later.',
          stopReason: 'error',
        });
      } else if (e instanceof AccessDeniedException) {
        const modelAccessURL = `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/modelaccess`;
        yield streamingChunk({
          text: `The selected model is not enabled. Please enable the model in the [Bedrock console Model Access screen](${modelAccessURL}).`,
          stopReason: 'error',
        });
      } else {
        console.error(e);
        yield streamingChunk({
          text:
            'An error occurred. Please report the following error to the administrator.\n' +
            e,
          stopReason: 'error',
        });
      }
    }
  },
  generateImage: async (model, params) => {
    const region = model.region || MODEL_REGION;
    const client = await initBedrockRuntimeClient({ region });

    // Image generation using Stable Diffusion or Titan Image Generator is not supported for the Converse API, so InvokeModelCommand is used.
    const command = new InvokeModelCommand({
      modelId: model.modelId,
      body: createBodyImage(model, params),
      contentType: 'application/json',
    });
    const res = await client.send(command);
    const body = JSON.parse(Buffer.from(res.body).toString('utf-8'));

    return extractOutputImage(model, body);
  },
  generateVideo: async (
    model,
    params: GenerateVideoParams,
    tenantId?: string,
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  ) => {
    const region = model.region || MODEL_REGION;
    const effectiveTenantId = tenantId || 'default';
    
    console.log(`Generating video for tenant: ${effectiveTenantId}, model: ${model.modelId}, region: ${region}`);
    console.log(`Using ${credentials ? 'tenant-scoped' : 'default'} credentials`);
    
    try {
      // Use tenant-scoped credentials when provided for ABAC
      const client = credentials 
        ? await initBedrockRuntimeClientWithCredentials({ region }, credentials)
        : await initBedrockRuntimeClient({ region });

      // Determine output bucket based on tenant
      const outputBucket = await getVideoBucketForGeneration(effectiveTenantId, region);
      console.log(`Using output bucket: ${outputBucket} for tenant: ${effectiveTenantId}`);

      const modelInput = createBodyVideo(model, params);
      console.log(`Model input created for ${model.modelId}`);

      const command = new StartAsyncInvokeCommand({
        modelId: model.modelId,
        modelInput,
        outputDataConfig: {
          s3OutputDataConfig: {
            s3Uri: `s3://${outputBucket}`,
            // bucketOwner removed - not needed for same-account access with proper IAM
          },
        },
      });

      console.log(`Sending StartAsyncInvokeCommand to Bedrock for model: ${model.modelId}`);
      
      // Retry mechanism for Bedrock calls
      let lastError: Error | null = null;
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 1000;
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await client.send(command);
          
          if (!res.invocationArn) {
            throw new Error('Bedrock response missing invocationArn');
          }
          
          console.log(`Video generation started successfully, invocationArn: ${res.invocationArn}`);
          return res.invocationArn;
        } catch (error) {
          lastError = error as Error;
          console.error(`Bedrock StartAsyncInvokeCommand attempt ${attempt} failed:`, {
            error: error instanceof Error ? error.message : String(error),
            modelId: model.modelId,
            tenantId: effectiveTenantId,
            attempt,
          });
          
          // Check if it's a retryable error
          const isRetryable = error instanceof AccessDeniedException ||
                              error instanceof ThrottlingException ||
                              error instanceof ServiceQuotaExceededException;
          
          if (attempt < MAX_RETRIES && isRetryable) {
            console.log(`Retrying Bedrock call in ${RETRY_DELAY * attempt}ms...`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
          } else if (!isRetryable) {
            // Don't retry for non-retryable errors
            throw error;
          }
        }
      }
      
      // All retries failed
      throw new Error(`Bedrock video generation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
    } catch (error) {
      console.error(`Video generation failed for tenant: ${effectiveTenantId}`, {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        modelId: model.modelId,
        region,
        tenantId: effectiveTenantId,
        hasCredentials: !!credentials,
        credentialsValid: credentials ? !!(credentials.accessKeyId && credentials.secretAccessKey) : null,
      });
      throw error;
    }
  },
};

export default bedrockApi;
