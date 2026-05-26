// Local smoke test for the web-search tool-use flow.
//
// Usage (from repo root):
//   $env:AWS_REGION = "us-east-1"
//   $env:SEARCH_API_KEY_SSM_PARAM = "/genu/brave-api-key"
//   $env:SEARCH_ENGINE = "Brave"
//   $env:MODEL_REGION = "us-east-1"
//   $env:MODEL_IDS = '[{"modelId":"us.anthropic.claude-3-5-haiku-20241022-v1:0","region":"us-east-1"}]'
//   npx ts-node --prefer-ts-exts packages/cdk/scripts/test-web-search.ts
//
// Optional override:
//   $env:TEST_PROMPT = "明日の東京の天気を教えて"
//   $env:TEST_MODEL_ID = "us.anthropic.claude-3-5-haiku-20241022-v1:0"
//
// Requires:
//   - AWS credentials with ssm:GetParameter / kms:Decrypt on the parameter
//   - Bedrock model access in MODEL_REGION
//   - SSM SecureString `/genu/brave-api-key` populated, OR set SEARCH_API_KEY directly

import { invokeStreamWithTools } from '../lambda/utils/bedrockApiWithTools';
import { Model, UnrecordedMessage } from 'generative-ai-use-cases';

const prompt =
  process.env.TEST_PROMPT ?? '明日の東京の天気を簡潔に教えて。出典 URL も載せて。';
const modelId =
  process.env.TEST_MODEL_ID ??
  'us.anthropic.claude-3-5-haiku-20241022-v1:0';

const model: Model = {
  type: 'bedrock',
  modelId,
  region: process.env.MODEL_REGION ?? 'us-east-1',
};

const messages: UnrecordedMessage[] = [{ role: 'user', content: prompt }];

const main = async () => {
  console.log('---- test-web-search ----');
  console.log('model :', model.modelId);
  console.log('region:', model.region);
  console.log('prompt:', prompt);
  console.log(
    'search:',
    process.env.SEARCH_API_KEY_SSM_PARAM
      ? `ssm=${process.env.SEARCH_API_KEY_SSM_PARAM}`
      : process.env.SEARCH_API_KEY
        ? 'env=SEARCH_API_KEY'
        : '(none — will fail with unauthorized)'
  );
  console.log('-------------------------');

  for await (const chunk of invokeStreamWithTools(model, messages, '/chat')) {
    // chunk is the JSONL streaming envelope produced by streamingChunk().
    // Print it raw so trace + text + stopReason are all visible.
    process.stdout.write(chunk);
  }
  console.log('\n---- done ----');
};

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
