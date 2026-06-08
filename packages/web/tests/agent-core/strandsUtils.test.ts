import { describe, it, expect } from 'vitest';
import { StrandsStreamProcessor } from '../../src/utils/strandsUtils';

const line = (obj: unknown) => JSON.stringify(obj);

describe('StrandsStreamProcessor.processEvent — llm_call observability event', () => {
  it('surfaces an llm_call event as { text: "", llmCall }', () => {
    const processor = new StrandsStreamProcessor();
    const llmCall = {
      llm_call_id: '11111111-1111-1111-1111-111111111111',
      agent_run_id: 'run-123',
      agent_id: 'medical_reimbursement_qa',
      model_id: 'jp.anthropic.claude-sonnet-4-5',
      input_tokens: 30078,
      output_tokens: 116,
      total_tokens: 30194,
      cache_read_input_tokens: 0,
      cache_write_input_tokens: 0,
      latency_ms: 3271,
      status: 'succeeded',
      error_type: null,
      created_at: '2026-06-04T00:00:00.000Z',
    };

    const result = processor.processEvent(
      line({ event: { llm_call: llmCall } })
    );

    expect(result).not.toBeNull();
    expect(result?.text).toBe('');
    expect(result?.llmCall).toEqual(llmCall);
  });

  it('still handles metadata events', () => {
    const processor = new StrandsStreamProcessor();
    const result = processor.processEvent(
      line({
        event: {
          metadata: {
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            metrics: { latencyMs: 100 },
          },
        },
      })
    );

    expect(result?.metadata?.usage.inputTokens).toBe(10);
    expect(result?.llmCall).toBeUndefined();
  });

  it('does not treat normal text deltas as llm_call', () => {
    const processor = new StrandsStreamProcessor();
    const result = processor.processEvent(
      line({ event: { contentBlockDelta: { delta: { text: 'hello' } } } })
    );

    expect(result?.text).toBe('hello');
    expect(result?.llmCall).toBeUndefined();
  });
});
