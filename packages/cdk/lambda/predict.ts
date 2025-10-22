import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  internalServerError500Response,
  ok200Response,
} from './utils/apiResponse';
import { getTenantCredentials } from './utils/tenantCredentials';
import { createOpenFgaClient, checkLlmAccess } from './utils/openFgaClient';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const req: PredictRequest = JSON.parse(event.body!);
    const model = req.model || defaultModel;
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    // Get tenant credentials and create OpenFGA client
    const { credentials } = await getTenantCredentials(event);
    const openFgaClient = await createOpenFgaClient(event, credentials);

    // Check authorization for the specific LLM model
    const hasAccess = await checkLlmAccess(openFgaClient, userId, model.modelId);
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

    const response = await api[model.type].invoke?.(
      model,
      req.messages,
      req.id
    );

    return ok200Response(response);
  } catch (error) {
    console.log(error);
    return internalServerError500Response({ message: 'Internal Server Error' });
  }
};
