import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAssistant } from './repository/assistant';
import { createMessage } from './repository/assistantMessage';
import { CreateAssistantMessageRequest } from 'generative-ai-use-cases';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.MODEL_REGION || process.env.AWS_REGION,
});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const assistantId = event.pathParameters?.assistantId;

    if (!assistantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Missing assistantId' }),
      };
    }

    const body: CreateAssistantMessageRequest = JSON.parse(event.body || '{}');

    if (!body.content) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Missing content' }),
      };
    }

    // Get assistant configuration
    const assistant = await getAssistant(assistantId, event);

    if (!assistant) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Assistant not found' }),
      };
    }

    // Verify ownership (userId is stored with 'user#' prefix)
    if (assistant.userId !== `user#${userId}`) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ message: 'Forbidden' }),
      };
    }

    // Store user message
    await createMessage(
      assistantId,
      userId,
      'user',
      body.content,
      undefined,
      undefined,
      event
    );

    // TODO: Implement RAG context retrieval from OpenSearch when ragEnabled is true
    // For now, we'll use the assistant's instruction as system context

    // Call Bedrock with assistant configuration
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: assistant.modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                text: body.content,
              },
            ],
          },
        ],
        system: [
          {
            text: assistant.instruction,
          },
        ],
      })
    );

    const assistantResponse =
      response.output?.message?.content?.[0]?.text || 'No response';

    const usage = {
      inputTokens: response.usage?.inputTokens || 0,
      outputTokens: response.usage?.outputTokens || 0,
      totalTokens: response.usage?.totalTokens || 0,
    };

    // Store assistant response
    const assistantMessage = await createMessage(
      assistantId,
      userId,
      'assistant',
      assistantResponse,
      [], // TODO: Add RAG sources when implemented
      { usage },
      event
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(assistantMessage),
    };
  } catch (error) {
    console.error('Error creating message:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
