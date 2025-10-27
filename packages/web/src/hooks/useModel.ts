import {
  Model,
  ModelConfiguration,
  ModelMetadata,
} from 'generative-ai-use-cases';
import {
  CRI_PREFIX_PATTERN,
  modelMetadata as originalModelMetadata,
} from '@generative-ai-use-cases/common';
import useModelsApi from './useModelsApi';
import { useMemo } from 'react';

// List of LiteLLM model IDs (configured to match config.yaml)
const liteLlmModelIds = ['gemini-2.5-flash', 'gemini-2.5-pro'];

// List of LangChain model IDs
const langchainModelIds = [
  // OpenAI
  'openai:gpt-4o',
  'openai:gpt-4o-mini',
  'openai:o3',
  'openai:gpt-4.1',
  'openai:gpt-5',
];

// Add metadata for liteLLM models (extended on frontend side)
const liteLlmModelMetadata: Record<string, ModelMetadata> = {
  'gemini-2.5-flash': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'Gemini 2.5 Flash',
  },
  'gemini-2.5-pro': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'Gemini 2.5 Pro',
  },
};

const langchainModelMetadata: Record<string, ModelMetadata> = {
  'openai:gpt-4o': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'GPT 4o',
  },
  'openai:gpt-4o-mini': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'GPT 4o mini',
  },
  'openai:o3': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'o3',
  },
  'openai:gpt-4.1': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'GPT 4.1',
  },
  'openai:gpt-5': {
    flags: { text: true, doc: true, image: true, video: false },
    displayName: 'GPT 5',
  },
};

// Merge LangChain metadata with original modelMetadata
const modelMetadata: Record<string, ModelMetadata> = {
  ...liteLlmModelMetadata,
  ...langchainModelMetadata,
  ...originalModelMetadata,
};

export const findModelByModelId = (
  modelId: string,
  textModels: Model[],
  imageGenModels: Model[],
  videoGenModels: Model[],
  agentModels: Model[]
) => {
  const model = [
    ...textModels,
    ...imageGenModels,
    ...videoGenModels,
    ...agentModels,
  ].find((m) => m.modelId === modelId);

  if (model) {
    // deep copy
    return JSON.parse(JSON.stringify(model));
  }

  return undefined;
};

export const useModels = () => {
  const { getModels } = useModelsApi();
  const { data, error, isLoading } = getModels();

  const modelsInfo = useMemo(() => {
    if (!data) {
      return null;
    }

    const modelRegion = data.modelRegion;
    const bedrockModelConfigs: ModelConfiguration[] = data.modelIds;
    const bedrockModelIds: string[] = bedrockModelConfigs.map(
      (model) => model.modelId
    );
    const lightModelIds: string[] = bedrockModelConfigs
      .filter((model) => originalModelMetadata[model.modelId]?.flags?.light)
      .map((model) => model.modelId);
    const modelIdsInModelRegion: string[] = bedrockModelConfigs
      .filter((model) => model.region === modelRegion)
      .map((model) => model.modelId);
    const duplicateBaseModelIds = new Set(
      bedrockModelIds
        .map((modelId) => modelId.replace(CRI_PREFIX_PATTERN, ''))
        .filter((item, index, arr) => arr.indexOf(item) !== index)
    );
    const visionModelIds: string[] = bedrockModelIds.filter(
      (modelId) => originalModelMetadata[modelId]?.flags?.image
    );
    const visionEnabled: boolean = visionModelIds.length > 0;

    const endpointNames: string[] = data.endpointNames;

    const imageModelConfigs: ModelConfiguration[] = data.imageModelIds;
    const imageGenModelIds: string[] = imageModelConfigs.map(
      (model) => model.modelId
    );

    const videoModelConfigs: ModelConfiguration[] = data.videoModelIds;
    const videoGenModelIds: string[] = videoModelConfigs.map(
      (model) => model.modelId
    );

    const speechToSpeechModelConfigs: ModelConfiguration[] =
      data.speechToSpeechModelIds;
    const speechToSpeechModelIds: string[] = speechToSpeechModelConfigs.map(
      (model) => model.modelId
    );

    const agentNames: string[] = data.agentNames;

    const flows = data.flows;

    // Define model objects
    const textModels = [
      ...bedrockModelConfigs.map(
        (model) =>
          ({
            modelId: model.modelId,
            type: 'bedrock',
            region: model.region,
          }) as Model
      ),
      ...endpointNames.map(
        (name) => ({ modelId: name, type: 'sagemaker' }) as Model
      ),
      // Temporary hardcoded addition of LiteLLM and LangChain models
      ...liteLlmModelIds.map(
        (modelId) => ({ modelId, type: 'liteLlm' }) as Model
      ),
      ...langchainModelIds.map(
        (modelId) => ({ modelId, type: 'langchain' }) as Model
      ),
    ];
    const imageGenModels = [
      ...imageModelConfigs.map(
        (model) =>
          ({
            modelId: model.modelId,
            type: 'bedrock',
            region: model.region,
          }) as Model
      ),
    ];
    const videoGenModels = [
      ...videoModelConfigs.map(
        (model) =>
          ({
            modelId: model.modelId,
            type: 'bedrock',
            region: model.region,
          }) as Model
      ),
    ];
    const speechToSpeechModels = [
      ...speechToSpeechModelConfigs.map(
        (model) =>
          ({
            modelId: model.modelId,
            type: 'bedrock',
            region: model.region,
          }) as Model
      ),
    ];
    const agentModels = [
      ...agentNames.map(
        (name) => ({ modelId: name, type: 'bedrockAgent' }) as Model
      ),
    ];

    const searchAgent = agentNames.find((name) => name.includes('Search'));

    const modelDisplayName = (modelId: string): string => {
      if (liteLlmModelMetadata[modelId]) {
        return liteLlmModelMetadata[modelId].displayName;
      }

      // Get display name from metadata for LangChain models
      if (langchainModelMetadata[modelId]) {
        return langchainModelMetadata[modelId].displayName;
      }

      // If there are multiple instances of the same model, add CRI suffix to the display name
      let displayName = modelMetadata[modelId]?.displayName ?? modelId;
      if (duplicateBaseModelIds.has(modelId.replace(CRI_PREFIX_PATTERN, ''))) {
        const criMatch = modelId.match(CRI_PREFIX_PATTERN);
        if (criMatch) {
          displayName += ` (${criMatch[1].toUpperCase()})`;
        }
      }
      return displayName;
    };

    return {
      modelRegion: modelRegion,
      modelIds: [
        ...bedrockModelIds,
        ...endpointNames,
        ...langchainModelIds,
        ...liteLlmModelIds,
      ],
      modelIdsInModelRegion,
      modelMetadata,
      modelDisplayName,
      lightModelIds,
      visionModelIds: visionModelIds,
      visionEnabled: visionEnabled,
      imageGenModelIds: imageGenModelIds,
      videoGenModelIds: videoGenModelIds,
      agentNames: agentNames,
      textModels: textModels,
      imageGenModels: imageGenModels,
      videoGenModels: videoGenModels,
      agentModels: agentModels,
      agentEnabled: agentNames.length > 0,
      searchAgent: searchAgent,
      flows,
      flowChatEnabled: flows.length > 0,
      speechToSpeechModelIds: speechToSpeechModelIds,
      speechToSpeechModels: speechToSpeechModels,
      findModelByModelId: (modelId: string) =>
        findModelByModelId(
          modelId,
          textModels,
          imageGenModels,
          videoGenModels,
          agentModels
        ),
    };
  }, [data]);

  return {
    models: modelsInfo,
    isLoading,
    error,
  };
};

// Export for backward compatibility - maintains the original MODELS constant interface
export const MODELS = {
  // These will be populated at runtime via useModels hook
  // Keeping this for any code that imports MODELS directly
  modelRegion: '',
  modelIds: [] as string[],
  modelIdsInModelRegion: [] as string[],
  modelMetadata,
  modelDisplayName: (modelId: string) => modelId,
  lightModelIds: [] as string[],
  visionModelIds: [] as string[],
  visionEnabled: false,
  imageGenModelIds: [] as string[],
  videoGenModelIds: [] as string[],
  agentNames: [] as string[],
  textModels: [] as Model[],
  imageGenModels: [] as Model[],
  videoGenModels: [] as Model[],
  agentModels: [] as Model[],
  agentEnabled: false,
  searchAgent: undefined as string | undefined,
  flows: [] as any[],
  flowChatEnabled: false,
  speechToSpeechModelIds: [] as string[],
  speechToSpeechModels: [] as Model[],
  findModelByModelId: (modelId: string) =>
    findModelByModelId(modelId, [], [], [], []),
};
