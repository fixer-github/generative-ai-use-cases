import {
  AgentCoreLlmCallEvent,
  AppendAgentLlmCallsRequest,
  CompleteAgentRunRequest,
  StartAgentRunRequest,
  ToBeRecordedMessage,
} from 'generative-ai-use-cases';

type AgentObservabilityApi = {
  startAgentRun: (req: StartAgentRunRequest) => Promise<unknown>;
  completeAgentRun: (req: CompleteAgentRunRequest) => Promise<unknown>;
  appendAgentLlmCalls: (req: AppendAgentLlmCallsRequest) => Promise<unknown>;
};

type Logger = {
  error: (...args: unknown[]) => void;
};

const canSaveAgentObservability = (
  agentRunId?: string,
  agentId?: string
): agentRunId is string => !!agentRunId && !!agentId;

const runBestEffort = async (
  label: string,
  action: () => Promise<unknown>,
  logger: Logger = console
) => {
  try {
    await action();
  } catch (error) {
    logger.error(`[observability] ${label} failed`, error);
  }
};

export const attachAgentObservabilityToMessages = (
  messages: ToBeRecordedMessage[],
  agentRunId?: string,
  agentId?: string
): ToBeRecordedMessage[] => {
  if (!canSaveAgentObservability(agentRunId, agentId)) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return message;
    }
    return {
      ...message,
      agentRunId,
      agentId,
    };
  });
};

export const startAgentRunBestEffort = async ({
  apis,
  agentRunId,
  agentId,
  sessionId,
  startedAt,
  logger,
}: {
  apis: Pick<AgentObservabilityApi, 'startAgentRun'>;
  agentRunId?: string;
  agentId?: string;
  sessionId?: string;
  startedAt: string;
  logger?: Logger;
}) => {
  if (!canSaveAgentObservability(agentRunId, agentId)) {
    return;
  }

  await runBestEffort(
    'startRun',
    () =>
      apis.startAgentRun({
        agent_run_id: agentRunId,
        agent_id: agentId!,
        session_id: sessionId,
        started_at: startedAt,
      }),
    logger
  );
};

export const saveAgentObservabilityCompletionBestEffort = async ({
  apis,
  agentRunId,
  agentId,
  sessionId,
  chatId,
  startedAt,
  endedAt,
  status,
  errorType,
  llmCalls,
  messages,
  logger,
}: {
  apis: Pick<AgentObservabilityApi, 'appendAgentLlmCalls' | 'completeAgentRun'>;
  agentRunId?: string;
  agentId?: string;
  sessionId?: string;
  chatId?: string;
  startedAt: string;
  endedAt: string;
  status: 'succeeded' | 'failed';
  errorType?: string | null;
  llmCalls?: AgentCoreLlmCallEvent[];
  messages?: ToBeRecordedMessage[];
  logger?: Logger;
}) => {
  if (!canSaveAgentObservability(agentRunId, agentId)) {
    return;
  }

  const userMessage = messages?.find((message) => message.role === 'user');
  const assistantMessage = messages
    ? [...messages].reverse().find((message) => message.role === 'assistant')
    : undefined;

  if (llmCalls && llmCalls.length > 0) {
    await runBestEffort(
      'appendLlmCalls',
      () =>
        apis.appendAgentLlmCalls({
          agent_run_id: agentRunId,
          llm_calls: llmCalls,
        }),
      logger
    );
  }

  await runBestEffort(
    'completeRun',
    () =>
      apis.completeAgentRun({
        agent_run_id: agentRunId,
        agent_id: agentId!,
        session_id: sessionId,
        chat_id: chatId,
        user_message_id: userMessage?.messageId,
        assistant_message_id: assistantMessage?.messageId,
        started_at: startedAt,
        ended_at: endedAt,
        status,
        error_type: errorType ?? null,
      }),
    logger
  );
};
