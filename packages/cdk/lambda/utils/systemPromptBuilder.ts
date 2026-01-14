import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Build system prompt from SSM Parameter Store
 * Retrieves and caches the system prompt from AWS Systems Manager Parameter Store
 * @param parameterPath Path to the SSM parameter containing the system prompt
 * @returns The system prompt string from SSM
 * @throws Error if parameter is not found or SSM call fails
 */
export async function buildSystemPromptFromSsm(parameterPath: string): Promise<string> {
  try {
    console.log(`Fetching system prompt from SSM parameter: ${parameterPath}`);

    const command = new GetParameterCommand({
      Name: parameterPath,
      WithDecryption: true,
    });

    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`SSM parameter ${parameterPath} not found or has no value`);
    }

    console.log(`Successfully fetched system prompt from SSM, length: ${response.Parameter.Value.length}`);
    return response.Parameter.Value;
  } catch (error) {
    console.error(`Failed to fetch system prompt from SSM at ${parameterPath}:`, error);
    throw error;
  }
}

/**
 * Cache for SSM parameter values to reduce API calls
 * Maps parameterPath -> { value, timestamp }
 */
const parameterCache = new Map<string, { value: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build system prompt from SSM Parameter Store with caching
 * Caches results for 5 minutes to reduce SSM API calls
 * @param parameterPath Path to the SSM parameter containing the system prompt
 * @returns The system prompt string from SSM
 * @throws Error if parameter is not found or SSM call fails
 */
export async function buildSystemPromptFromSsmWithCache(parameterPath: string): Promise<string> {
  const now = Date.now();
  const cached = parameterCache.get(parameterPath);

  // Return cached value if available and not expired
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    console.log(`Using cached system prompt for ${parameterPath}`);
    return cached.value;
  }

  const prompt = await buildSystemPromptFromSsm(parameterPath);

  // Cache the result
  parameterCache.set(parameterPath, { value: prompt, timestamp: now });

  return prompt;
}
