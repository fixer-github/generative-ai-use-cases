import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { AssistantMessage } from 'generative-ai-use-cases';
import * as process from 'node:process';

/**
 * Helper function to add assistantId to messages for API response
 * Messages are stored without assistantId, but API expects it
 */
export function addAssistantIdToMessage(
  message: AssistantMessage,
  assistantId: string
): AssistantMessage {
  return {
    ...message,
    assistantId,
  };
}

export function createBedrockClient() {
  const bedrockClient = new BedrockRuntimeClient({
    region: process.env.MODEL_REGION || process.env.AWS_REGION,
  });

  return bedrockClient;
}
