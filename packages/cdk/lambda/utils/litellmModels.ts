/**
 * Utility functions for handling LiteLLM models
 */

import { Model } from 'generative-ai-use-cases';

/**
 * Check if a model ID is a LiteLLM model
 * LiteLLM models are prefixed with 'litellm/'
 */
export function isLiteLLMModel(modelId: string): boolean {
  return modelId.startsWith('litellm/');
}

/**
 * Convert a model configuration to use LiteLLM if needed
 * This function checks if the model ID starts with 'litellm/' and adjusts the type
 */
export function adjustModelForLiteLLM(model: Model): Model {
  if (!model.modelId) {
    return model;
  }
  
  if (isLiteLLMModel(model.modelId)) {
    return {
      ...model,
      type: 'liteLlm',
      // Remove the 'litellm/' prefix for the actual model ID sent to LiteLLM
      modelId: model.modelId.replace('litellm/', ''),
    };
  }
  
  return model;
}

/**
 * Process model configuration from request
 * This ensures LiteLLM models are properly routed
 */
export function processModelConfig(model: Model | undefined, defaultModel: Model): Model {
  const selectedModel = model || defaultModel;
  return adjustModelForLiteLLM(selectedModel);
}