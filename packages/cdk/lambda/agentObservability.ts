import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  AppendAgentLlmCallsRequest,
  CompleteAgentRunRequest,
  StartAgentRunRequest,
} from 'generative-ai-use-cases';
import {
  appendAgentLlmCalls,
  completeAgentRun,
  startAgentRun,
} from './repositoryAgentObservability';

class ValidationError extends Error {}

const jsonResponse = (
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

const parseBody = (event: APIGatewayProxyEvent): unknown => {
  if (!event.body) {
    throw new ValidationError('Request body is required');
  }
  return JSON.parse(event.body);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (obj: Record<string, unknown>, key: string): string => {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${key} is required`);
  }
  return value;
};

const parseStartRun = (body: unknown): StartAgentRunRequest => {
  if (!isObject(body)) {
    throw new ValidationError('Request body must be an object');
  }
  return {
    agent_run_id: requireString(body, 'agent_run_id'),
    agent_id: requireString(body, 'agent_id'),
    session_id:
      typeof body.session_id === 'string' ? body.session_id : undefined,
    chat_id: typeof body.chat_id === 'string' ? body.chat_id : undefined,
    started_at: requireString(body, 'started_at'),
  };
};

const parseCompleteRun = (body: unknown): CompleteAgentRunRequest => {
  if (!isObject(body)) {
    throw new ValidationError('Request body must be an object');
  }
  const status = requireString(body, 'status');
  if (status !== 'succeeded' && status !== 'failed') {
    throw new ValidationError('status must be succeeded or failed');
  }
  return {
    agent_run_id: requireString(body, 'agent_run_id'),
    agent_id: requireString(body, 'agent_id'),
    session_id:
      typeof body.session_id === 'string' ? body.session_id : undefined,
    chat_id: typeof body.chat_id === 'string' ? body.chat_id : undefined,
    user_message_id:
      typeof body.user_message_id === 'string'
        ? body.user_message_id
        : undefined,
    assistant_message_id:
      typeof body.assistant_message_id === 'string'
        ? body.assistant_message_id
        : undefined,
    started_at:
      typeof body.started_at === 'string' ? body.started_at : undefined,
    ended_at: requireString(body, 'ended_at'),
    status,
    error_type:
      typeof body.error_type === 'string' || body.error_type === null
        ? body.error_type
        : undefined,
  };
};

const parseAppendLlmCalls = (body: unknown): AppendAgentLlmCallsRequest => {
  if (!isObject(body)) {
    throw new ValidationError('Request body must be an object');
  }
  if (!Array.isArray(body.llm_calls)) {
    throw new ValidationError('llm_calls must be an array');
  }
  return {
    agent_run_id: requireString(body, 'agent_run_id'),
    llm_calls: body.llm_calls as AppendAgentLlmCallsRequest['llm_calls'],
  };
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const operation = event.pathParameters?.operation;
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const runBase = {
      tenant_id: process.env.TENANT_ID!,
      environment_id: process.env.ENVIRONMENT_ID!,
      user_id: userId,
    };
    const body = parseBody(event);

    if (operation === 'start-run') {
      await startAgentRun(parseStartRun(body), runBase);
      return jsonResponse(200, { ok: true });
    }

    if (operation === 'complete-run') {
      await completeAgentRun(parseCompleteRun(body), runBase);
      return jsonResponse(200, { ok: true });
    }

    if (operation === 'llm-calls') {
      const req = parseAppendLlmCalls(body);
      await appendAgentLlmCalls(req.agent_run_id, req.llm_calls);
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(404, { message: 'Unknown observability operation' });
  } catch (error) {
    console.log(error);
    const message = error instanceof Error ? error.message : 'Invalid request';
    return jsonResponse(error instanceof ValidationError ? 400 : 500, {
      message:
        error instanceof ValidationError ? message : 'Internal Server Error',
    });
  }
};
