import {
  calcLlmCostYen,
  calcTranscribeCostYen,
  normalizeModelKey,
  usecaseToCategory,
  isLicenseExemptUsecase,
  currentMonthKey,
  nextResetDate,
} from '../../lambda/utils/license';

describe('license cost conversion', () => {
  // JP-region prices for Sonnet 4.5 (list price x 1.1)
  const sonnetPrice = {
    inputUsdPerMTok: 3.3,
    outputUsdPerMTok: 16.5,
    cacheReadUsdPerMTok: 0.33,
    cacheWriteUsdPerMTok: 4.125,
  };

  test('LLM cost combines all four token buckets at their own unit prices', () => {
    const yen = calcLlmCostYen(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheWriteInputTokens: 1_000_000,
      },
      sonnetPrice,
      150
    );
    // (3.3 + 16.5 + 0.33 + 4.125) USD * 150 JPY/USD
    expect(yen).toBeCloseTo(24.255 * 150, 6);
  });

  test('missing usage fields count as zero', () => {
    const yen = calcLlmCostYen({ outputTokens: 2_000 }, sonnetPrice, 150);
    expect(yen).toBeCloseTo((2_000 * 16.5 * 150) / 1_000_000, 9);
  });

  test('transcribe cost is per-minute based', () => {
    // 90 seconds at $0.006/min, 150 JPY/USD
    expect(calcTranscribeCostYen(90, 0.006, 150)).toBeCloseTo(1.35, 9);
    // streaming rate is higher
    expect(calcTranscribeCostYen(90, 0.01, 150)).toBeCloseTo(2.25, 9);
  });
});

describe('normalizeModelKey', () => {
  test('strips regional prefix and version suffix', () => {
    expect(
      normalizeModelKey('jp.anthropic.claude-sonnet-4-5-20250929-v1:0')
    ).toBe('claude-sonnet-4-5');
    expect(
      normalizeModelKey('us.anthropic.claude-haiku-4-5-20251001-v1:0')
    ).toBe('claude-haiku-4-5');
    expect(normalizeModelKey('anthropic.claude-opus-4-5-20251101-v1:0')).toBe(
      'claude-opus-4-5'
    );
  });

  test('falls back to the full id for unknown formats', () => {
    expect(normalizeModelKey('amazon.nova-canvas-v1:0')).toBe(
      'amazon.nova-canvas-v1:0'
    );
  });
});

describe('usecase mapping', () => {
  test('RAG paths are exempt, others are not', () => {
    expect(isLicenseExemptUsecase('/rag')).toBe(true);
    expect(isLicenseExemptUsecase('/rag-knowledge-base')).toBe(true);
    expect(isLicenseExemptUsecase('/chat')).toBe(false);
    expect(isLicenseExemptUsecase('meeting-minutes-123')).toBe(false);
    expect(isLicenseExemptUsecase(undefined)).toBe(false);
  });

  test('usecase ids map to ledger categories', () => {
    expect(usecaseToCategory('/chat')).toBe('chat');
    expect(usecaseToCategory('/chat/abc')).toBe('chat');
    expect(usecaseToCategory('/summarize')).toBe('summarize');
    expect(usecaseToCategory('/translate')).toBe('translate');
    expect(usecaseToCategory('/generate')).toBe('generation');
    expect(usecaseToCategory('/diagram')).toBe('generation');
    expect(usecaseToCategory('meeting-minutes-1722300000000')).toBe(
      'generation'
    );
    // unknown paths default to chat
    expect(usecaseToCategory('/something-else')).toBe('chat');
    expect(usecaseToCategory(undefined)).toBe('chat');
  });
});

describe('month keys', () => {
  test('current month key has YYYY-MM format', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });

  test('reset date is the 1st of a month', () => {
    expect(nextResetDate()).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
