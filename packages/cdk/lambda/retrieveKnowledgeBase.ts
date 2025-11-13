import * as lambda from 'aws-lambda';
import { RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { RetrieveKnowledgeBaseRequest } from 'generative-ai-use-cases';
import { initBedrockAgentRuntimeClient } from './utils/bedrockClient';
import { ok200Response, badRequest400Response } from './utils/apiResponse';

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const MODEL_REGION = process.env.MODEL_REGION as string;

exports.handler = async (
  event: lambda.APIGatewayProxyEvent
): Promise<lambda.APIGatewayProxyResult> => {
  const req = JSON.parse(event.body!) as RetrieveKnowledgeBaseRequest;
  const query = req.query;

  if (!query) {
    return badRequest400Response('query is not specified');
  }

  const client = await initBedrockAgentRuntimeClient({ region: MODEL_REGION });
  const retrieveCommand = new RetrieveCommand({
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: { text: query },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 10,
        overrideSearchType: 'HYBRID',
      },
    },
  });
  const retrieveRes = await client.send(retrieveCommand);

  return ok200Response(retrieveRes);
};
