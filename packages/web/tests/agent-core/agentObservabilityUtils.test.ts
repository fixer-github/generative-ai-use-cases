import { describe, expect, it, vi } from 'vitest';
import {
  attachAgentObservabilityToMessages,
  saveAgentObservabilityCompletionBestEffort,
  startAgentRunBestEffort,
} from '../../src/utils/agentObservabilityUtils';
import {
  AgentCoreLlmCallEvent,
  ToBeRecordedMessage,
} from 'generative-ai-use-cases';

const messages: ToBeRecordedMessage[] = [
  {
    messageId: 'user-message-1',
    role: 'user',
    content: 'question',
    usecase: '/agent-core',
  },
  {
    messageId: 'assistant-message-1',
    role: 'assistant',
    content: 'answer',
    usecase: '/agent-core',
  },
];

const llmCall: AgentCoreLlmCallEvent = {
  llm_call_id: 'call-1',
  agent_run_id: 'run-1',
  agent_id: 'medical-reimbursement-qa',
  model_id: 'jp.anthropic.claude-sonnet-4-5',
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  cache_read_input_tokens: 0,
  cache_write_input_tokens: 0,
  latency_ms: 100,
  status: 'succeeded',
  error_type: null,
  created_at: '2026-06-04T00:00:00.000Z',
};

describe('agent observability helpers', () => {
  it('attaches agentRunId and agentId only to user and assistant messages', () => {
    const withSystemMessage: ToBeRecordedMessage[] = [
      {
        messageId: 'system-message-1',
        role: 'system',
        content: 'system',
        usecase: '/agent-core',
      },
      ...messages,
    ];

    const result = attachAgentObservabilityToMessages(
      withSystemMessage,
      'run-1',
      'medical-reimbursement-qa'
    );

    expect(result[0].agentRunId).toBeUndefined();
    expect(result[1]).toMatchObject({
      agentRunId: 'run-1',
      agentId: 'medical-reimbursement-qa',
    });
    expect(result[2]).toMatchObject({
      agentRunId: 'run-1',
      agentId: 'medical-reimbursement-qa',
    });
  });

  it('does not attach observability ids when either id is missing', () => {
    const result = attachAgentObservabilityToMessages(
      messages,
      'run-1',
      undefined
    );

    expect(result).toEqual(messages);
  });

  it('does not call startRun when ids are missing', async () => {
    const startAgentRun = vi.fn();

    await startAgentRunBestEffort({
      apis: { startAgentRun },
      agentRunId: 'run-1',
      agentId: undefined,
      startedAt: '2026-06-04T00:00:00.000Z',
    });

    expect(startAgentRun).not.toHaveBeenCalled();
  });

  it('continues to completeRun when appendLlmCalls fails', async () => {
    const logger = { error: vi.fn() };
    const appendAgentLlmCalls = vi.fn().mockRejectedValue(new Error('append'));
    const completeAgentRun = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      saveAgentObservabilityCompletionBestEffort({
        apis: { appendAgentLlmCalls, completeAgentRun },
        agentRunId: 'run-1',
        agentId: 'medical-reimbursement-qa',
        sessionId: 'session-1',
        chatId: 'chat-1',
        startedAt: '2026-06-04T00:00:00.000Z',
        endedAt: '2026-06-04T00:00:01.000Z',
        status: 'succeeded',
        errorType: null,
        llmCalls: [llmCall],
        messages,
        logger,
      })
    ).resolves.toBeUndefined();

    expect(appendAgentLlmCalls).toHaveBeenCalledWith({
      agent_run_id: 'run-1',
      llm_calls: [llmCall],
    });
    expect(completeAgentRun).toHaveBeenCalledWith({
      agent_run_id: 'run-1',
      agent_id: 'medical-reimbursement-qa',
      session_id: 'session-1',
      chat_id: 'chat-1',
      user_message_id: 'user-message-1',
      assistant_message_id: 'assistant-message-1',
      started_at: '2026-06-04T00:00:00.000Z',
      ended_at: '2026-06-04T00:00:01.000Z',
      status: 'succeeded',
      error_type: null,
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[observability] appendLlmCalls failed',
      expect.any(Error)
    );
  });

  it('does not throw when completeRun fails', async () => {
    const logger = { error: vi.fn() };
    const appendAgentLlmCalls = vi.fn();
    const completeAgentRun = vi.fn().mockRejectedValue(new Error('complete'));

    await expect(
      saveAgentObservabilityCompletionBestEffort({
        apis: { appendAgentLlmCalls, completeAgentRun },
        agentRunId: 'run-1',
        agentId: 'medical-reimbursement-qa',
        startedAt: '2026-06-04T00:00:00.000Z',
        endedAt: '2026-06-04T00:00:01.000Z',
        status: 'failed',
        errorType: 'RuntimeError',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(appendAgentLlmCalls).not.toHaveBeenCalled();
    expect(completeAgentRun).toHaveBeenCalledWith({
      agent_run_id: 'run-1',
      agent_id: 'medical-reimbursement-qa',
      session_id: undefined,
      chat_id: undefined,
      user_message_id: undefined,
      assistant_message_id: undefined,
      started_at: '2026-06-04T00:00:00.000Z',
      ended_at: '2026-06-04T00:00:01.000Z',
      status: 'failed',
      error_type: 'RuntimeError',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[observability] completeRun failed',
      expect.any(Error)
    );
  });
});
