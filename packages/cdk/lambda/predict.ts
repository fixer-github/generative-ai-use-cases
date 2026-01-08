import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';
import { createOpenFgaClient, checkLlmAccess } from './utils/openFgaClient';
import { buildSummaryContext } from './utils/summaryContext';
import { UnrecordedMessage } from 'generative-ai-use-cases';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: PredictRequest = JSON.parse(event.body!);
    const model = req.model || defaultModel;
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    // Create OpenFGA client (internally gets tenant credentials)
    const openFgaClient = await createOpenFgaClient(event);

    // Check authorization for the specific LLM model
    const hasAccess = await checkLlmAccess(
      openFgaClient,
      userId,
      model.modelId
    );
    if (!hasAccess) {
      console.warn(
        `User ${userId} does not have access to model ${model.modelId}`
      );
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: `You do not have permission to use the model: ${model.modelId}`,
        }),
      };
    }

    // Inject summary context
    let messages: UnrecordedMessage[] = req.messages;
    try {
      if (userId) {
        const summaryContext = await buildSummaryContext(userId, event);

        if (summaryContext) {
          messages = req.messages.map((msg) => {
            if (msg.role === 'system') {
              return {
                ...msg,
                content: `${msg.content}\n\n${summaryContext}`,
              };
            }
            return msg;
          });
        }
      }
    } catch (error) {
      // Continue without summary context if injection fails
      console.error('Failed to inject summary context:', error);
    }

    const response = await api[model.type].invoke?.(model, messages, req.id);

    return ok200Response(response);
  } catch (error) {
    console.log(error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
