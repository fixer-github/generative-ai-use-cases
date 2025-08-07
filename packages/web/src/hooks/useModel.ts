import { Model, ModelConfiguration } from 'generative-ai-use-cases';
import {
  CRI_PREFIX_PATTERN,
  modelMetadata as originalModelMetadata,
} from '@generative-ai-use-cases/common';

const modelRegion = import.meta.env.VITE_APP_MODEL_REGION;

// Get model names and other environment variables
const bedrockModelConfigs = (
  JSON.parse(import.meta.env.VITE_APP_MODEL_IDS) as ModelConfiguration[]
)
  .map((model) => ({
    modelId: model.modelId.trim(),
    region: model.region.trim(),
  }))
  .filter((model) => model.modelId);
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

const endpointNames: string[] = JSON.parse(
  import.meta.env.VITE_APP_ENDPOINT_NAMES
)
  .map((name: string) => name.trim())
  .filter((name: string) => name);

const imageModelConfigs = (
  JSON.parse(import.meta.env.VITE_APP_IMAGE_MODEL_IDS) as ModelConfiguration[]
)
  .map(
    (model: ModelConfiguration): ModelConfiguration => ({
      modelId: model.modelId.trim(),
      region: model.region.trim(),
    })
  )
  .filter((model) => model.modelId);
const imageGenModelIds: string[] = imageModelConfigs.map(
  (model) => model.modelId
);

const videoModelConfigs = (
  JSON.parse(import.meta.env.VITE_APP_VIDEO_MODEL_IDS) as ModelConfiguration[]
)
  .map(
    (model: ModelConfiguration): ModelConfiguration => ({
      modelId: model.modelId.trim(),
      region: model.region.trim(),
    })
  )
  .filter((model) => model.modelId);
const videoGenModelIds: string[] = videoModelConfigs.map(
  (model) => model.modelId
);
const speechToSpeechModelConfigs = (
  JSON.parse(
    import.meta.env.VITE_APP_SPEECH_TO_SPEECH_MODEL_IDS
  ) as ModelConfiguration[]
)
  .map(
    (model: ModelConfiguration): ModelConfiguration => ({
      modelId: model.modelId.trim(),
      region: model.region.trim(),
    })
  )
  .filter((model) => model.modelId);
const speechToSpeechModelIds: string[] = speechToSpeechModelConfigs.map(
  (model) => model.modelId
);

const agentNames: string[] = JSON.parse(import.meta.env.VITE_APP_AGENT_NAMES)
  .map((name: string) => name.trim())
  .filter((name: string) => name);

const getFlows = () => {
  try {
    return JSON.parse(import.meta.env.VITE_APP_FLOWS);
  } catch (e) {
    return [];
  }
};

const flows = getFlows();

// Get LiteLLM models from environment if LiteLLM proxy is enabled
const getLiteLlmModels = (): ModelConfiguration[] => {
  const litellmEnabled = import.meta.env.VITE_APP_LITELLM_PROXY_ENABLED === 'true';
  if (!litellmEnabled) {
    return [];
  }
  
  try {
    const models = JSON.parse(import.meta.env.VITE_APP_LITELLM_MODEL_IDS || '[]') as ModelConfiguration[];
    return models
      .map((model) => ({
        modelId: model.modelId.trim(),
        region: model.region?.trim() || modelRegion,
      }))
      .filter((model) => model.modelId);
  } catch (e) {
    console.warn('Failed to parse LiteLLM models:', e);
    return [];
  }
};

const liteLlmModelConfigs = getLiteLlmModels();
const liteLlmModelIds = liteLlmModelConfigs.map((model) => model.modelId);

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
  // Dynamic LiteLLM models from environment configuration
  ...liteLlmModelConfigs.map(
    (model) => ({
      modelId: model.modelId,
      type: 'liteLlm',
      region: model.region,
    }) as Model
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

export const findModelByModelId = (modelId: string) => {
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

const searchAgent = agentNames.find((name) => name.includes('Search'));

// Generate metadata for LiteLLM models dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const generateLiteLlmModelMetadata = (): Record<string, any> => {
  const metadata: Record<string, any> = {};
  
  liteLlmModelIds.forEach((modelId) => {
    // Remove 'litellm/' prefix for display and metadata
    const cleanModelId = modelId.replace('litellm/', '');
    
    // Generate display name from model ID
    let displayName = cleanModelId;
    
    // Format common model names
    if (cleanModelId.includes('gpt')) {
      displayName = cleanModelId.toUpperCase().replace('-', ' ');
    } else if (cleanModelId.includes('claude')) {
      displayName = 'Claude ' + cleanModelId.replace('claude-', '').replace('-', ' ');
    } else if (cleanModelId.includes('gemini')) {
      displayName = 'Gemini ' + cleanModelId.replace('gemini-', '').replace('-', ' ');
    } else if (cleanModelId.includes('azure')) {
      displayName = 'Azure ' + cleanModelId.replace('azure-', '').replace('-', ' ');
    } else if (cleanModelId.includes('nova')) {
      displayName = 'Nova ' + cleanModelId.replace('nova-', '').replace('-', ' ');
    }
    
    // Set default flags for LiteLLM models
    // Most LiteLLM models support text and documents
    // Image support depends on the specific model
    const hasImageSupport = cleanModelId.includes('gpt-4') || 
                           cleanModelId.includes('claude-3') || 
                           cleanModelId.includes('gemini');
    
    metadata[modelId] = {
      flags: { 
        text: true, 
        doc: true, 
        image: hasImageSupport, 
        video: false 
      },
      displayName: displayName + ' (via LiteLLM)',
    };
  });
  
  return metadata;
};

const liteLlmModelMetadata = generateLiteLlmModelMetadata();

// Merge liteLLM metadata with original modelMetadata
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelMetadata: Record<string, any> = {
  ...originalModelMetadata,
  ...liteLlmModelMetadata,
};

const modelDisplayName = (modelId: string): string => {
  // Check if it's a LiteLLM model (has litellm/ prefix or is in liteLlmModelMetadata)
  if (modelId.startsWith('litellm/') || liteLlmModelMetadata[modelId]) {
    return liteLlmModelMetadata[modelId]?.displayName ?? modelId;
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

export const MODELS = {
  modelRegion: modelRegion,
  modelIds: [...bedrockModelIds, ...endpointNames, ...liteLlmModelIds],
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
};
