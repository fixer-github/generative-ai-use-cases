/**
 * Model unit prices (single source of truth).
 *
 * JP-region (jp.) unit prices in USD per 1M tokens = Anthropic list x 1.1
 * (requirement 16). Keyed by normalized model name so that every regional
 * variant of a model (jp./us./global., dated or dateless ID) resolves to the
 * same price entry.
 *
 * This module is imported both by Lambdas (seeding, runtime lookup) and by
 * the CDK synth (deploy-time validation in construct/api.ts), so it must not
 * pull in any AWS SDK dependency.
 */

export type ModelPrice = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
};

// Normalize a Bedrock model ID to the price table key.
// 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0' -> 'claude-sonnet-4-5'
// 'jp.anthropic.claude-sonnet-4-6'               -> 'claude-sonnet-4-6'
// Non-Anthropic IDs are returned unchanged.
export const normalizeModelKey = (modelId: string): string => {
  const idx = modelId.indexOf('anthropic.');
  const base = idx >= 0 ? modelId.slice(idx + 'anthropic.'.length) : modelId;
  const m = base.match(/^(.*?)-\d{8}-v\d+(?::\d+)?$/);
  return m ? m[1] : base;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': {
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 5.5,
    cacheReadUsdPerMTok: 0.11,
    cacheWriteUsdPerMTok: 1.375,
  },
  'claude-sonnet-4-5': {
    inputUsdPerMTok: 3.3,
    outputUsdPerMTok: 16.5,
    cacheReadUsdPerMTok: 0.33,
    cacheWriteUsdPerMTok: 4.125,
  },
  // Sonnet 4.6 keeps the 4.5 list price ($3 / $15)
  'claude-sonnet-4-6': {
    inputUsdPerMTok: 3.3,
    outputUsdPerMTok: 16.5,
    cacheReadUsdPerMTok: 0.33,
    cacheWriteUsdPerMTok: 4.125,
  },
  'claude-opus-4-5': {
    inputUsdPerMTok: 5.5,
    outputUsdPerMTok: 27.5,
    cacheReadUsdPerMTok: 0.55,
    cacheWriteUsdPerMTok: 6.875,
  },
  // Opus 4.8 keeps the 4.5 list price ($5 / $25)
  'claude-opus-4-8': {
    inputUsdPerMTok: 5.5,
    outputUsdPerMTok: 27.5,
    cacheReadUsdPerMTok: 0.55,
    cacheWriteUsdPerMTok: 6.875,
  },
};

// Price entry for a model ID as seeded at deploy time. The runtime lookup
// goes through DynamoDB instead (editable without a deploy); this helper is
// for deploy-time validation and seeding.
export const findSeedPrice = (modelId: string): ModelPrice | undefined => {
  return MODEL_PRICES[normalizeModelKey(modelId)] ?? MODEL_PRICES[modelId];
};
