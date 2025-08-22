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

// List of LangChain model IDs (configured to match config.yaml)
const langchainModelIds = [
  // Azure OpenAI
  'azure_openai:o3',
  'azure_openai:gpt-4.1',
  'azure_openai:gpt-5',

  // Google VertexAI
  // 'gemini-2.5-flash',
  // 'gemini-2.5-pro',

  // Amazon Bedrock
  'bedrock:us.anthropic.claude-sonnet-4-20250514-v1:0',
  'bedrock:us.anthropic.claude-opus-4-20250514-v1:0',
  'bedrock:us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'bedrock:us.anthropic.claude-3-5-haiku-20241022-v1:0',
  'bedrock:us.amazon.nova-premier-v1:0',
  'bedrock:us.amazon.nova-pro-v1:0',
  'bedrock:us.amazon.nova-lite-v1:0',
  'bedrock:us.amazon.nova-micro-v1:0',
  'bedrock:us.deepseek.r1-v1:0',
];

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
  // Temporary hardcoded addition of LangChain models
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

// Add metadata for liteLLM models (extended on frontend side)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// const liteLlmModelMetadata: Record<string, any> = {
//   'gpt-5': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'GPT-5',
//   },
//   'gpt-4o': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'GPT-4o',
//   },
//   'gpt-4o-mini': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'GPT-4o Mini',
//   },
//   o3: {
//     flags: {
//       text: true,
//       doc: true,
//       image: false,
//       video: false,
//       reasoning: true,
//     },
//     displayName: 'o3',
//   },
//   'gpt-4.1': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'GPT-4.1',
//   },
//   'gemini-2.5-flash': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'Gemini 2.5 Flash',
//   },
//   'gemini-2.5-pro': {
//     flags: { text: true, doc: true, image: true, video: false },
//     displayName: 'Gemini 2.5 Pro',
//   },
// };

const langchainModelMetadata: Record<string, any> = {
  'azure_openai:gpt-4o': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'GPT 4o',
  },
  'azure_openai:gpt-4o-mini': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'GPT 4o mini',
  },
  'azure_openai:o3': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'o3',
  },
  'azure_openai:gpt-4.1': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'GPT 4.1',
  },
  'azure_openai:gpt-5': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'GPT 5',
  },
  // 'gemini-2.5-flash': {
  //   flags: { text: true, doc: true, image: false, video: false },
  //   displayName: 'Gemini 2.5 Flash',
  // },
  // 'gemini-2.5-pro': {
  //   flags: { text: true, doc: true, image: false, video: false },
  //   displayName: 'Gemini 2.5 Pro',
  // },
  'bedrock:anthropic.claude-sonnet-4-20250514-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Claude Sonnet 4',
  },
  'bedrock:anthropic.claude-opus-4-20250514-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Claude Opus 4',
  },
  'bedrock:anthropic.claude-3-7-sonnet-20250219-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Claude 3.7 Sonnet',
  },
  'bedrock:anthropic.claude-3-5-haiku-20241022-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Claude 3.5 Haiku',
  },
  'bedrock:amazon.nova-premier-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Nova Premier',
  },
  'bedrock:amazon.nova-pro-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Nova Pro',
  },
  'bedrock:amazon.nova-lite-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Nova Lite',
  },
  'bedrock:amazon.nova-micro-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'Nova Micro',
  },
  'bedrock:deepseek.r1-v1:0': {
    flags: { text: true, doc: true, image: false, video: false },
    displayName: 'DeepSeek r1',
  },
};

// Merge LangChain metadata with original modelMetadata
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelMetadata: Record<string, any> = {
  ...langchainModelMetadata,
  ...originalModelMetadata,
};

const modelDisplayName = (modelId: string): string => {
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

export const MODELS = {
  modelRegion: modelRegion,
  modelIds: [...bedrockModelIds, ...endpointNames, ...langchainModelIds],
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
