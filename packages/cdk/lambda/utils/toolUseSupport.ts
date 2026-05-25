// Decides which models support the Converse "toolUse" feature for the chat
// web-search flow. Kept independent from models.ts so that upstream changes to
// model definitions do not require edits here (and vice versa).
//
// When adding a new model upstream, extend the SUPPORTED patterns below if it
// supports tool use. The strategy is "deny obvious unsupported, then allow by
// supported pattern".

const TOOL_USE_UNSUPPORTED_PATTERNS: RegExp[] = [
  /anthropic\.claude-instant/,
  /amazon\.titan-text/,
  /mistral\.mistral-7b/,
  /mistral\.mixtral-/,
  /meta\.llama2-/,
  /meta\.llama3-(?:[0-9]+b)/, // base llama 3 (non-versioned) does not support
  /cohere\.command-(text|light)/,
  /deepseek\./, // deepseek-r1 etc. - no tool use as of writing
];

const TOOL_USE_SUPPORTED_PATTERNS: RegExp[] = [
  // Claude 3 / 3.5 / 3.7 / 4.x
  /anthropic\.claude-3-/,
  /anthropic\.claude-(opus|sonnet|haiku)-4/,
  /anthropic\.claude-sonnet-4/,
  /anthropic\.claude-opus-4/,
  /anthropic\.claude-haiku-4/,
  // Amazon Nova
  /amazon\.nova-(pro|lite|premier|micro)/,
  // Llama 3.1+
  /meta\.llama3-[1-9]/,
  // Mistral Large
  /mistral\.mistral-large/,
  // Cohere Command R
  /cohere\.command-r/,
];

export const supportsToolUse = (modelId: string): boolean => {
  if (!modelId) return false;
  if (TOOL_USE_UNSUPPORTED_PATTERNS.some((p) => p.test(modelId))) return false;
  return TOOL_USE_SUPPORTED_PATTERNS.some((p) => p.test(modelId));
};
