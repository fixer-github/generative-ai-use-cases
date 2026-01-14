import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SystemContextParams } from 'generative-ai-use-cases';

const ssm = new SSMClient({});
const promptCache: Map<string, string> = new Map();

// SSM path prefix - configurable via environment variable
const SSM_PREFIX = process.env.SYSTEM_PROMPT_SSM_PREFIX || '/prompts/system';

async function getFromSSM(key: string): Promise<string> {
  const path = `${SSM_PREFIX}/${key}`;
  if (promptCache.has(path)) {
    return promptCache.get(path)!;
  }

  try {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: path,
        WithDecryption: false,
      })
    );
    const value = result.Parameter?.Value || '';
    promptCache.set(path, value);
    return value;
  } catch (error) {
    console.error(`Failed to get SSM parameter ${path}:`, error);
    return '';
  }
}

export async function buildSystemPrompt(
  params: SystemContextParams
): Promise<string> {
  // Get base prompt template from SSM
  const basePrompt = await getFromSSM('base');

  // Get variant-specific prompt if specified
  const variantPrompt = params.promptVariant
    ? await getFromSSM(`variants/${params.promptVariant}`)
    : '';

  // Build final prompt with user context
  return `${basePrompt}

${variantPrompt}

<user_context>
<interests>
${params.interests || ''}
</interests>

<goals>
${params.goals || ''}
</goals>
</user_context>`;
}
