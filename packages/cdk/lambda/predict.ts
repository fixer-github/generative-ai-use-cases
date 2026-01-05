import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PredictRequest, UnrecordedMessage } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';
import { buildSummaryContext } from './utils/summaryContext';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: PredictRequest = JSON.parse(event.body!);
    const model = req.model || defaultModel;

    // Inject summary context
    let messages: UnrecordedMessage[] = req.messages;
    try {
      const userId =
        event.requestContext.authorizer?.claims?.['cognito:username'];
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
