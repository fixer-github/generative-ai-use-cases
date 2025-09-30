import { StreamingChunk } from '@generative-ai-use-cases/types';

// JSONL Format
export const streamingChunk = (chunk: StreamingChunk): string => {
  return JSON.stringify(chunk) + '\n';
};
