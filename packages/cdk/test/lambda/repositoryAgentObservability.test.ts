import { AgentCoreLlmCallEvent } from 'generative-ai-use-cases';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class UpdateCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class BatchWriteCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({
        send: sendMock,
      })),
    },
    PutCommand,
    UpdateCommand,
    BatchWriteCommand,
  };
});

describe('repositoryAgentObservability', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    process.env = {
      ...originalEnv,
      AGENT_OBSERVABILITY_TABLE_NAME: 'AgentObservabilityTable',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const importRepository = async () => {
    return await import('../../lambda/repositoryAgentObservability');
  };

  test('startAgentRun writes the run item shape', async () => {
    const { startAgentRun } = await importRepository();

    await startAgentRun(
      {
        agent_run_id: 'run-1',
        agent_id: 'medical-reimbursement-qa',
        session_id: 'session-1',
        chat_id: 'chat-1',
        started_at: '2026-06-04T00:00:00.000Z',
      },
      {
        tenant_id: '123456789012',
        environment_id: 'TestStack',
        user_id: 'user-1',
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({
      TableName: 'AgentObservabilityTable',
      Item: {
        agent_run_id: 'run-1',
        sk: 'run',
        record_type: 'run',
        agent_id: 'medical-reimbursement-qa',
        tenant_id: '123456789012',
        environment_id: 'TestStack',
        user_id: 'user-1',
        session_id: 'session-1',
        chat_id: 'chat-1',
        started_at: '2026-06-04T00:00:00.000Z',
        status: 'running',
        error_type: null,
        GSI1PK: 'medical-reimbursement-qa',
        GSI1SK: '2026-06-04T00:00:00.000Z#run-1',
      },
    });
  });

  test('completeAgentRun updates run status and message links', async () => {
    const { completeAgentRun } = await importRepository();

    await completeAgentRun(
      {
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
      },
      {
        tenant_id: '123456789012',
        environment_id: 'TestStack',
        user_id: 'user-1',
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      TableName: 'AgentObservabilityTable',
      Key: {
        agent_run_id: 'run-1',
        sk: 'run',
      },
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':recordType': 'run',
        ':agentId': 'medical-reimbursement-qa',
        ':tenantId': '123456789012',
        ':environmentId': 'TestStack',
        ':userId': 'user-1',
        ':sessionId': 'session-1',
        ':chatId': 'chat-1',
        ':userMessageId': 'user-message-1',
        ':assistantMessageId': 'assistant-message-1',
        ':startedAt': '2026-06-04T00:00:00.000Z',
        ':endedAt': '2026-06-04T00:00:01.000Z',
        ':status': 'succeeded',
        ':errorType': null,
        ':gsi1sk': '2026-06-04T00:00:00.000Z#run-1',
      },
    });
    expect(sendMock.mock.calls[0][0].input.UpdateExpression).toContain(
      'user_message_id = :userMessageId'
    );
    expect(sendMock.mock.calls[0][0].input.UpdateExpression).toContain(
      'assistant_message_id = :assistantMessageId'
    );
    expect(sendMock.mock.calls[0][0].input.UpdateExpression).toContain(
      '#status = :status'
    );
  });

  test('appendAgentLlmCalls writes llm_call items with the contract sort key', async () => {
    const { appendAgentLlmCalls } = await importRepository();
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

    await appendAgentLlmCalls('run-1', [llmCall]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({
      RequestItems: {
        AgentObservabilityTable: [
          {
            PutRequest: {
              Item: {
                ...llmCall,
                agent_run_id: 'run-1',
                sk: 'llm_call#2026-06-04T00:00:00.000Z#call-1',
                record_type: 'llm_call',
                GSI1PK: 'medical-reimbursement-qa',
                GSI1SK: '2026-06-04T00:00:00.000Z#run-1',
              },
            },
          },
        ],
      },
    });
  });

  test('appendAgentLlmCalls throws when DynamoDB returns unprocessed items', async () => {
    const { appendAgentLlmCalls } = await importRepository();
    sendMock.mockResolvedValue({
      UnprocessedItems: {
        AgentObservabilityTable: [
          {
            PutRequest: {
              Item: {
                agent_run_id: 'run-1',
              },
            },
          },
        ],
      },
    });

    await expect(
      appendAgentLlmCalls('run-1', [
        {
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
        },
      ])
    ).rejects.toThrow('Some llm_call items were not processed');
  });
});
