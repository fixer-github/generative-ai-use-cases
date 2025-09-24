import { HiddenUseCases, HiddenUseCasesKeys } from 'generative-ai-use-cases';

/**
 * Parse global hidden use cases from environment variable with proper error handling
 */
export const parseGlobalHiddenUseCases = (): HiddenUseCases => {
  try {
    const envValue = process.env.HIDDEN_USE_CASES;
    return envValue ? JSON.parse(envValue) : {};
  } catch (error) {
    console.error('Failed to parse HIDDEN_USE_CASES environment variable:', error);
    return {};
  }
};

/**
 * Valid use case keys derived from TypeScript keyof operator
 */
const VALID_USE_CASE_KEYS = [
  'generate',
  'summarize', 
  'writer',
  'translate',
  'webContent',
  'image',
  'video',
  'videoAnalyzer',
  'diagram',
  'meetingMinutes',
  'voiceChat'
] as const satisfies readonly HiddenUseCasesKeys[];

/**
 * Type-safe validation using TypeScript's keyof operator
 */
export const isValidUseCaseKey = (key: string): key is HiddenUseCasesKeys => {
  return VALID_USE_CASE_KEYS.includes(key as HiddenUseCasesKeys);
};

/**
 * Validate hidden use cases configuration with comprehensive error handling
 */
export const validateHiddenUseCases = (input: unknown): HiddenUseCases => {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const hiddenUseCases = input as Record<string, unknown>;
  const validated: HiddenUseCases = {};
  
  for (const [key, value] of Object.entries(hiddenUseCases)) {
    if (isValidUseCaseKey(key) && typeof value === 'boolean') {
      validated[key] = value;
    }
  }
  
  return validated;
};

/**
 * Common response structure for use case configuration endpoints
 */
export interface UseCaseConfigResponse {
  tenantId: string | null;
  hiddenUseCases: HiddenUseCases;
  source: 'tenant' | 'global' | 'global_fallback';
  globalHiddenUseCases?: HiddenUseCases;
  error?: string;
}

/**
 * Create a standardized use case configuration response
 */
export const createUseCaseConfigResponse = (
  tenantId: string | null,
  hiddenUseCases: HiddenUseCases,
  source: 'tenant' | 'global' | 'global_fallback',
  options?: {
    globalHiddenUseCases?: HiddenUseCases;
    error?: string;
  }
): UseCaseConfigResponse => {
  return {
    tenantId,
    hiddenUseCases,
    source,
    ...options,
  };
};
