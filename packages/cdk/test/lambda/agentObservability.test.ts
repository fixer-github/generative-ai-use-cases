import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../lambda/agentObservability';
import {
  appendAgentLlmCalls,
  completeAgentRun,
  startAgentRun,
} from '../../lambda/repositoryAgentObservability';

jest.mock('../../lambda/repositoryAgentObservability');

const mockedStartAgentRun = startAgentRun as jest.MockedFunction<
  typeof startAgentRun
>;
const mockedCompleteAgentRun = completeAgentRun as jest.MockedFunction<
  typeof completeAgentRun
>;
const mockedAppendAgentLlmCalls = appendAgentLlmCalls as jest.MockedFunction<
  typeof appendAgentLlmCalls
>;

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    TENANT_ID: '123456789012',
    ENVIRONMENT_ID: 'TestStack',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

const createEvent = (
  operation: string,
  body: Record<string, unknown>
): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    pathParameters: { operation },
    requestContext: {
      authorizer: {
        claims: {
          'cognito:username': 'test-user',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('agentObservability Lambda handler', () => {
  test('starts an agent run', async () => {
    const req = {
      agent_run_id: 'run-1',
      agent_id: 'medical-reimbursement-qa',
      session_id: 'session-1',
      started_at: '2026-06-04T00:00:00.000Z',
    };

    const result = await handler(createEvent('start-run', req));

    expect(result.statusCode).toBe(200);
    expect(mockedStartAgentRun).toHaveBeenCalledWith(req, {
      tenant_id: '123456789012',
      environment_id: 'TestStack',
      user_id: 'test-user',
    });
  });

  test('completes an agent run', async () => {
    const req = {
      agent_run_id: 'run-1',
      agent_id: 'medical-reimbursement-qa',
      session_id: 'session-1',
      chat_id: 'chat#1',
      user_message_id: 'user-message-1',
      assistant_message_id: 'assistant-message-1',
      started_at: '2026-06-04T00:00:00.000Z',
      ended_at: '2026-06-04T00:00:01.000Z',
      status: 'succeeded',
      error_type: null,
    };

    const result = await handler(createEvent('complete-run', req));

    expect(result.statusCode).toBe(200);
    expect(mockedCompleteAgentRun).toHaveBeenCalledWith(req, {
      tenant_id: '123456789012',
      environment_id: 'TestStack',
      user_id: 'test-user',
    });
  });

  test('appends llm_call events', async () => {
    const llmCall = {
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

    const result = await handler(
      createEvent('llm-calls', {
        agent_run_id: 'run-1',
        llm_calls: [llmCall],
      })
    );

    expect(result.statusCode).toBe(200);
    expect(mockedAppendAgentLlmCalls).toHaveBeenCalledWith('run-1', [llmCall]);
  });

  test('returns 400 for invalid complete status', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    const result = await handler(
      createEvent('complete-run', {
        agent_run_id: 'run-1',
        agent_id: 'medical-reimbursement-qa',
        ended_at: '2026-06-04T00:00:01.000Z',
        status: 'running',
      })
    );

    expect(result.statusCode).toBe(400);
    expect(mockedCompleteAgentRun).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });

  test('returns 500 when repository write fails', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    mockedStartAgentRun.mockRejectedValue(new Error('ddb unavailable'));

    const result = await handler(
      createEvent('start-run', {
        agent_run_id: 'run-1',
        agent_id: 'medical-reimbursement-qa',
        started_at: '2026-06-04T00:00:00.000Z',
      })
    );

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Internal Server Error',
    });

    consoleLogSpy.mockRestore();
  });
});
