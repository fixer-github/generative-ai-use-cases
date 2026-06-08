import {
  AgentCoreLlmCallEvent,
  CompleteAgentRunRequest,
  StartAgentRunRequest,
} from 'generative-ai-use-cases';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const AGENT_OBSERVABILITY_TABLE_NAME: string =
  process.env.AGENT_OBSERVABILITY_TABLE_NAME!;
const dynamoDb = new DynamoDBClient({});
const dynamoDbDocument = DynamoDBDocumentClient.from(dynamoDb);

type RunBase = {
  tenant_id: string;
  environment_id: string;
  user_id: string;
};

const definedEntries = (item: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined)
  );

export const startAgentRun = async (
  req: StartAgentRunRequest,
  runBase: RunBase
): Promise<void> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: AGENT_OBSERVABILITY_TABLE_NAME,
      Item: definedEntries({
        agent_run_id: req.agent_run_id,
        sk: 'run',
        record_type: 'run',
        agent_id: req.agent_id,
        tenant_id: runBase.tenant_id,
        environment_id: runBase.environment_id,
        user_id: runBase.user_id,
        session_id: req.session_id,
        chat_id: req.chat_id,
        started_at: req.started_at,
        status: 'running',
        error_type: null,
        GSI1PK: req.agent_id,
        GSI1SK: `${req.started_at}#${req.agent_run_id}`,
      }),
    })
  );
};

export const completeAgentRun = async (
  req: CompleteAgentRunRequest,
  runBase: RunBase
): Promise<void> => {
  const startedAt = req.started_at ?? req.ended_at;

  await dynamoDbDocument.send(
    new UpdateCommand({
      TableName: AGENT_OBSERVABILITY_TABLE_NAME,
      Key: {
        agent_run_id: req.agent_run_id,
        sk: 'run',
      },
      UpdateExpression: `
        SET
          record_type = if_not_exists(record_type, :recordType),
          agent_id = if_not_exists(agent_id, :agentId),
          tenant_id = if_not_exists(tenant_id, :tenantId),
          environment_id = if_not_exists(environment_id, :environmentId),
          user_id = if_not_exists(user_id, :userId),
          session_id = :sessionId,
          chat_id = :chatId,
          user_message_id = :userMessageId,
          assistant_message_id = :assistantMessageId,
          started_at = if_not_exists(started_at, :startedAt),
          ended_at = :endedAt,
          #status = :status,
          error_type = :errorType,
          GSI1PK = if_not_exists(GSI1PK, :agentId),
          GSI1SK = if_not_exists(GSI1SK, :gsi1sk)
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':recordType': 'run',
        ':agentId': req.agent_id,
        ':tenantId': runBase.tenant_id,
        ':environmentId': runBase.environment_id,
        ':userId': runBase.user_id,
        ':sessionId': req.session_id ?? null,
        ':chatId': req.chat_id ?? null,
        ':userMessageId': req.user_message_id ?? null,
        ':assistantMessageId': req.assistant_message_id ?? null,
        ':startedAt': startedAt,
        ':endedAt': req.ended_at,
        ':status': req.status,
        ':errorType': req.error_type ?? null,
        ':gsi1sk': `${startedAt}#${req.agent_run_id}`,
      },
    })
  );
};

export const appendAgentLlmCalls = async (
  agentRunId: string,
  llmCalls: AgentCoreLlmCallEvent[]
): Promise<void> => {
  const chunkSize = 25;
  for (let i = 0; i < llmCalls.length; i += chunkSize) {
    const chunk = llmCalls.slice(i, i + chunkSize);
    const res = await dynamoDbDocument.send(
      new BatchWriteCommand({
        RequestItems: {
          [AGENT_OBSERVABILITY_TABLE_NAME]: chunk.map((llmCall) => ({
            PutRequest: {
              Item: definedEntries({
                ...llmCall,
                agent_run_id: agentRunId,
                sk: `llm_call#${llmCall.created_at}#${llmCall.llm_call_id}`,
                record_type: 'llm_call',
                GSI1PK: llmCall.agent_id,
                GSI1SK: `${llmCall.created_at}#${agentRunId}`,
              }),
            },
          })),
        },
      })
    );
    if (
      res.UnprocessedItems?.[AGENT_OBSERVABILITY_TABLE_NAME] &&
      res.UnprocessedItems[AGENT_OBSERVABILITY_TABLE_NAME].length > 0
    ) {
      throw new Error('Some llm_call items were not processed');
    }
  }
};
