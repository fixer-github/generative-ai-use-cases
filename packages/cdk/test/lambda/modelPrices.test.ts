/**
 * modelPrices — normalization of Bedrock model IDs and seed price lookup.
 */
import {
  normalizeModelKey,
  findSeedPrice,
  MODEL_PRICES,
} from '../../lambda/utils/modelPrices';

describe('normalizeModelKey', () => {
  test('strips region prefix and dated version suffix', () => {
    expect(
      normalizeModelKey('jp.anthropic.claude-sonnet-4-5-20250929-v1:0')
    ).toBe('claude-sonnet-4-5');
    expect(
      normalizeModelKey('us.anthropic.claude-haiku-4-5-20251001-v1:0')
    ).toBe('claude-haiku-4-5');
    expect(
      normalizeModelKey('global.anthropic.claude-opus-4-8-20260101-v1:0')
    ).toBe('claude-opus-4-8');
    expect(normalizeModelKey('anthropic.claude-opus-4-5-20251101-v1:0')).toBe(
      'claude-opus-4-5'
    );
  });

  test('handles dateless model ids', () => {
    expect(normalizeModelKey('jp.anthropic.claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6'
    );
    expect(normalizeModelKey('us.anthropic.claude-opus-4-8')).toBe(
      'claude-opus-4-8'
    );
    expect(normalizeModelKey('anthropic.claude-haiku-4-5')).toBe(
      'claude-haiku-4-5'
    );
  });

  test('handles version suffix without a build number', () => {
    expect(
      normalizeModelKey('jp.anthropic.claude-sonnet-4-5-20250929-v1')
    ).toBe('claude-sonnet-4-5');
  });

  test('returns non-Anthropic ids unchanged', () => {
    expect(normalizeModelKey('us.amazon.nova-pro-v1:0')).toBe(
      'us.amazon.nova-pro-v1:0'
    );
    expect(normalizeModelKey('amazon.nova-canvas-v1:0')).toBe(
      'amazon.nova-canvas-v1:0'
    );
  });
});

describe('MODEL_PRICES', () => {
  test('has entries for the deployed model generations', () => {
    expect(MODEL_PRICES['claude-haiku-4-5']).toBeDefined();
    expect(MODEL_PRICES['claude-sonnet-4-5']).toBeDefined();
    expect(MODEL_PRICES['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICES['claude-opus-4-5']).toBeDefined();
    expect(MODEL_PRICES['claude-opus-4-8']).toBeDefined();
  });

  test('JP-region prices are Anthropic list price x 1.1', () => {
    expect(MODEL_PRICES['claude-sonnet-4-6'].inputUsdPerMTok).toBeCloseTo(
      3 * 1.1,
      9
    );
    expect(MODEL_PRICES['claude-sonnet-4-6'].outputUsdPerMTok).toBeCloseTo(
      15 * 1.1,
      9
    );
    expect(MODEL_PRICES['claude-opus-4-8'].inputUsdPerMTok).toBeCloseTo(
      5 * 1.1,
      9
    );
    expect(MODEL_PRICES['claude-haiku-4-5'].inputUsdPerMTok).toBeCloseTo(
      1 * 1.1,
      9
    );
  });
});

describe('findSeedPrice', () => {
  test('every regional/dated variant resolves to the same price entry', () => {
    const expected = MODEL_PRICES['claude-sonnet-4-5'];
    const variants = [
      'jp.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'jp.anthropic.claude-sonnet-4-5',
      'claude-sonnet-4-5',
    ];
    for (const id of variants) {
      expect(findSeedPrice(id)).toBe(expected);
    }
  });

  test('resolves prices for sonnet-4-6, opus-4-8 and haiku-4-5', () => {
    expect(findSeedPrice('jp.anthropic.claude-sonnet-4-6')).toBe(
      MODEL_PRICES['claude-sonnet-4-6']
    );
    expect(findSeedPrice('global.anthropic.claude-opus-4-8')).toBe(
      MODEL_PRICES['claude-opus-4-8']
    );
    expect(findSeedPrice('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(
      MODEL_PRICES['claude-haiku-4-5']
    );
  });

  test('returns undefined for models without a registered price', () => {
    expect(findSeedPrice('us.amazon.nova-pro-v1:0')).toBeUndefined();
    expect(findSeedPrice('anthropic.claude-unknown-9-9')).toBeUndefined();
  });
});
