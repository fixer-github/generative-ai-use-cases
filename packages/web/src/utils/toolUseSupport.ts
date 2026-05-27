// Mirror of packages/cdk/lambda/utils/toolUseSupport.ts.
// Keep the patterns in sync between frontend and backend so the unsupported
// banner reflects what the Lambda will actually do.

const TOOL_USE_UNSUPPORTED_PATTERNS: RegExp[] = [
  /anthropic\.claude-instant/,
  /amazon\.titan-text/,
  /mistral\.mistral-7b/,
  /mistral\.mixtral-/,
  /meta\.llama2-/,
  /meta\.llama3-(?:[0-9]+b)/,
  /cohere\.command-(text|light)/,
  /deepseek\./,
];

const TOOL_USE_SUPPORTED_PATTERNS: RegExp[] = [
  /anthropic\.claude-3-/,
  /anthropic\.claude-(opus|sonnet|haiku)-4/,
  /anthropic\.claude-sonnet-4/,
  /anthropic\.claude-opus-4/,
  /anthropic\.claude-haiku-4/,
  /amazon\.nova-(pro|lite|premier|micro)/,
  /meta\.llama3-[1-9]/,
  /mistral\.mistral-large/,
  /cohere\.command-r/,
];

export const supportsToolUse = (modelId: string): boolean => {
  if (!modelId) return false;
  if (TOOL_USE_UNSUPPORTED_PATTERNS.some((p) => p.test(modelId))) return false;
  return TOOL_USE_SUPPORTED_PATTERNS.some((p) => p.test(modelId));
};
