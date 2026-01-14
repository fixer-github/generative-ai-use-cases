import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SystemContextParams } from 'generative-ai-use-cases';

const ssm = new SSMClient({});
const promptCache: Map<string, { value: string; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const ENV = process.env.ENVIRONMENT || '';
const SSM_PREFIX = process.env.SYSTEM_PROMPT_SSM_PREFIX || '/prompts/system';

async function getFromSSM(path: string): Promise<string> {
  const now = Date.now();
  const cached = promptCache.get(path);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const result = await ssm.send(new GetParameterCommand({
      Name: path,
      WithDecryption: false,
    }));
    const value = result.Parameter?.Value || '';
    promptCache.set(path, { value, timestamp: now });
    return value;
  } catch (error) {
    console.error(`Failed to get SSM parameter ${path}:`, error);
    return '';
  }
}

export async function buildSystemPrompt(params: SystemContextParams): Promise<string> {
  // Fetch base prompt
  const basePrompt = await getFromSSM(`${ENV}${SSM_PREFIX}/base`);

  // Fetch variant prompt if specified
  const variantPrompt = params.promptVariant
    ? await getFromSSM(`${ENV}${SSM_PREFIX}/variants/${params.promptVariant}`)
    : '';

  // Build user context section
  const userContext = (params.interests || params.goals)
    ? `<user_context>
<interests>
${params.interests || ''}
</interests>
<goals>
${params.goals || ''}
</goals>
</user_context>`
    : '';

  // Combine all parts
  const parts = [basePrompt, variantPrompt, userContext].filter(Boolean);
  return parts.join('\n\n');
}
