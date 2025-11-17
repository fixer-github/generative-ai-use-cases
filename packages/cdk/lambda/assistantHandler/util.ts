import { Assistant } from 'generative-ai-use-cases';

/**
 * Helper function to normalize assistant data for API responses
 * - Strips "assistant#" prefix from assistantId
 * - Strips "user#" prefix from userId and id for anonymity and frontend compatibility
 * Internal storage uses prefixed format, but API returns clean values
 */
export function stripAssistantPrefix(assistant: Assistant): Assistant {
  return {
    ...assistant,
    assistantId: assistant.assistantId.replace(/^(assistant#)+/, ''),
    userId: assistant.userId.replace(/^user#/, ''),
    id: assistant.id.replace(/^user#/, ''), // Normalize partition key duplicate
  };
}
